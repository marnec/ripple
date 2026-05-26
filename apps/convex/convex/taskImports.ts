// CSV-driven bulk task import.
//
// Flow:
//   client parses CSV with papaparse → validates with @shared/taskImportSchema
//   → calls createImportJob → mutation reserves a task-number range, persists
//   the job doc, enqueues runImport on the taskImportPool
//   → workpool action calls createImportedTask once per row
//
// Validation lives at two layers that share one zod schema:
//   1. Loose convex args (`rows: v.array(v.any())`) — keeps old job docs
//      readable as the CSV format evolves; no schema migrations on column add.
//   2. Strict zod (`taskImportRowSchema`) — applied client-side, again in
//      createImportJob defensively, and once more in createImportedTask
//      before each insert so a single bad row doesn't abort the job.

import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateKeyBetween } from "fractional-indexing";
import { writerWithTriggers } from "convex-helpers/server/triggers";

import { triggers } from "./dbTriggers";
import { logTaskActivity } from "./auditLog";
import { requireWorkspaceMember, checkResourceMember } from "./authHelpers";
import { syncTaskTags } from "./tagSync";
import { enrichedTaskValidator } from "./tasks";
import { scheduleTaskImport } from "./taskImportPool";
import {
  TASK_IMPORT_MAX_PAYLOAD_BYTES,
  taskImportRowsSchema,
  taskImportRowOutputSchema,
  type TaskImportRow,
} from "@ripple/shared/taskImportSchema";

const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

const importJobValidator = v.object({
  _id: v.id("taskImportJobs"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  workspaceId: v.id("workspaces"),
  creatorId: v.id("users"),
  status: jobStatusValidator,
  totalRows: v.number(),
  processedRows: v.number(),
  failedRows: v.number(),
  numberRangeStart: v.number(),
  errorMessage: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  // Integration-import metadata. Absent on CSV jobs; present once a GitHub
  // import writes them. `projectActiveJob` only strips the heavy `rows` blob,
  // so these pass through and must be allowed by the projection validator.
  sourceType: v.optional(
    v.union(v.literal("csv"), v.literal("github_integration")),
  ),
  projectIntegrationLinkId: v.optional(v.id("projectIntegrationLinks")),
});

// ── Queries ─────────────────────────────────────────────────────────────

/**
 * Latest queued-or-running import for the project, or null.
 *
 * Drives both the Import button's disabled state and the active-import
 * banner. Returns a minimal projection — the full row payload is never sent
 * to the client (it's only meaningful to the workpool action).
 */
export const getActiveJobForProject = query({
  args: { projectId: v.id("projects") },
  returns: v.union(importJobValidator, v.null()),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return null;

    // Queued and running are the two "active" statuses. Two indexed lookups
    // are cheaper than a filter over all jobs for the project.
    const queued = await ctx.db
      .query("taskImportJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "queued"),
      )
      .order("desc")
      .first();
    if (queued) return projectActiveJob(queued);

    const running = await ctx.db
      .query("taskImportJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "running"),
      )
      .order("desc")
      .first();
    if (running) return projectActiveJob(running);

    return null;
  },
});

/** Job metadata for the status page header. */
export const getJob = query({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.union(importJobValidator, v.null()),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const auth = await checkResourceMember(ctx, "projects", job.projectId);
    if (!auth) return null;
    return projectActiveJob(job);
  },
});

/**
 * Tasks created by a single import job, newest first.
 *
 * Reuses the same `enrichedTaskValidator` shape that the project task list
 * consumes so the status page can render `<TaskRow>` directly.
 */
export const listJobTasks = query({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.array(enrichedTaskValidator),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return [];
    const auth = await checkResourceMember(ctx, "projects", job.projectId);
    if (!auth) return [];
    const project = auth.resource;

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_importJob", (q) => q.eq("importJobId", jobId))
      .order("desc") // newest creationTime first
      .collect();

    return Promise.all(
      tasks.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
        const blockerEdges = await ctx.db
          .query("edges")
          .withIndex("by_target", (q) => q.eq("targetId", task._id))
          .collect();
        return {
          ...task,
          status,
          assignee,
          projectKey: project.key,
          hasBlockers: blockerEdges.some((e) => e.edgeType === "blocks"),
        };
      }),
    );
  },
});

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * Create the job document and queue the workpool action.
 *
 * Performs defensive validation against the shared zod schema before any
 * write — a stale or tampering client cannot bypass row checks just because
 * the args validator is loose.
 */
export const createImportJob = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    // Loose intentionally: the strict shape lives in @shared/taskImportSchema
    // and is re-validated below. See file header for the rationale.
    rows: v.array(v.any()),
  },
  returns: v.id("taskImportJobs"),
  handler: async (ctx, { projectId, workspaceId, rows }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");
    if (project.workspaceId !== workspaceId) {
      throw new ConvexError("Project does not belong to the given workspace");
    }

    // Defensive zod re-parse — phase-1 validation, server side. Surfaces a
    // structured error so the client can re-open the validation dialog.
    // Issues are serialized to plain objects because ConvexError data must
    // be JSON-compatible Values.
    const parsed = taskImportRowsSchema.safeParse(rows);
    if (!parsed.success) {
      throw new ConvexError({
        code: "INVALID_ROWS",
        message: `Validation failed for ${parsed.error.issues.length} field(s).`,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((p) => String(p)),
          message: iss.message,
          code: iss.code,
        })),
      });
    }
    const validatedRows: TaskImportRow[] = parsed.data;

    if (validatedRows.length === 0) {
      throw new ConvexError("CSV contains no rows.");
    }

    // Concurrency guard: at most one queued/running job per project.
    const activeQueued = await ctx.db
      .query("taskImportJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "queued"),
      )
      .first();
    const activeRunning = activeQueued
      ? null
      : await ctx.db
          .query("taskImportJobs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", projectId).eq("status", "running"),
          )
          .first();
    if (activeQueued || activeRunning) {
      throw new ConvexError({
        code: "IMPORT_ALREADY_RUNNING",
        message: "An import job is already running for this project.",
        jobId: (activeQueued ?? activeRunning)!._id,
      });
    }

    // Reserve a contiguous task-number range — one counter patch for the
    // whole job rather than N patches inside the workpool action. Failed
    // rows leave numbering gaps; that's the same trade-off as a failed
    // tasks.create and acceptable for a sequence id.
    const counter = project.taskCounter ?? 0;
    const numberRangeStart = counter + 1;
    await ctx.db.patch(projectId, {
      taskCounter: counter + validatedRows.length,
    });

    let jobId;
    try {
      jobId = await ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: validatedRows,
        numberRangeStart,
        totalRows: validatedRows.length,
        processedRows: 0,
        failedRows: 0,
      });
    } catch (err) {
      // Belt-and-braces: client also pre-checks payload size, but
      // JSON-escape inflation or unusually long titles can still trip the
      // 1MB doc limit. Surface a friendly error instead of leaking the
      // internal limit message.
      const msg = err instanceof Error ? err.message : String(err);
      if (/1\s*MB|too large|exceeds/i.test(msg)) {
        throw new ConvexError(
          "CSV payload too large to import as a single job. Please split it into multiple smaller files.",
        );
      }
      throw err;
    }

    await scheduleTaskImport(ctx, internal.taskImports.runImport, { jobId });

    return jobId;
  },
});

// ── Workpool action ────────────────────────────────────────────────────

/**
 * Sequential per-row task creation. The action is the orchestrator; each
 * row becomes one internal mutation call so a single failure can't roll
 * back the whole job's writes.
 */
export const runImport = internalAction({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const startResult = await ctx.runMutation(internal.taskImports.startJob, { jobId });
    if (!startResult) return null;
    const { totalRows } = startResult;

    for (let i = 0; i < totalRows; i++) {
      try {
        await ctx.runMutation(internal.taskImports.createImportedTask, {
          jobId,
          rowIndex: i,
        });
      } catch (err) {
        // createImportedTask is built to swallow per-row failures into the
        // job's failedRows counter, so reaching here means the mutation
        // itself threw uncaught (e.g. transient infra). Treat as a row
        // failure rather than aborting the whole job.
        console.error("taskImports.runImport row failure", { jobId, rowIndex: i, err });
        await ctx.runMutation(internal.taskImports.recordRowFailure, { jobId });
      }
    }

    await ctx.runMutation(internal.taskImports.finalizeJob, { jobId });
    return null;
  },
});

// ── Internal mutations ─────────────────────────────────────────────────

export const startJob = internalMutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.union(v.object({ totalRows: v.number() }), v.null()),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.status !== "queued") return { totalRows: job.totalRows };
    await ctx.db.patch(jobId, { status: "running" });
    return { totalRows: job.totalRows };
  },
});

export const finalizeJob = internalMutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    await ctx.db.patch(jobId, {
      status: job.failedRows === job.totalRows ? "failed" : "completed",
      completedAt: Date.now(),
    });
    return null;
  },
});

export const recordRowFailure = internalMutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    await ctx.db.patch(jobId, {
      processedRows: job.processedRows + 1,
      failedRows: job.failedRows + 1,
    });
    return null;
  },
});

/**
 * Create one task from one stored row. Mirrors `tasks.create` but:
 *   - uses the pre-reserved task number (numberRangeStart + rowIndex)
 *     instead of incrementing project.taskCounter,
 *   - records per-row parse failures in the job rather than throwing,
 *   - tags the new task with `importJobId` so the status page can list it,
 *   - skips assignment notifications (no assignee in v1).
 */
export const createImportedTask = internalMutation({
  args: {
    jobId: v.id("taskImportJobs"),
    rowIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, rowIndex }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    const rawRow = job.rows[rowIndex];

    // Third validation pass — structural check on the already-parsed row
    // we persisted. Uses the output schema (typed values, no coercion) so
    // it doesn't re-reject a `labels: string[]` that the input schema
    // would only accept as a raw `string`. Catches storage corruption and
    // the case where the running version's schema is tighter than the one
    // that originally accepted the row.
    const parsed = taskImportRowOutputSchema.safeParse(rawRow);
    if (!parsed.success) {
      await ctx.db.patch(jobId, {
        processedRows: job.processedRows + 1,
        failedRows: job.failedRows + 1,
      });
      return null;
    }
    const row = parsed.data;

    const project = await ctx.db.get(job.projectId);
    if (!project) {
      await ctx.db.patch(jobId, {
        processedRows: job.processedRows + 1,
        failedRows: job.failedRows + 1,
      });
      return null;
    }

    const defaultStatus = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_isDefault", (q) =>
        q.eq("projectId", job.projectId).eq("isDefault", true),
      )
      .first();
    if (!defaultStatus) {
      throw new ConvexError("No default status found for project. Ensure statuses are seeded.");
    }

    // Position: append after the last task in the default status column.
    // Each new task computes off the live state so concurrent imports
    // across different projects don't interfere.
    const tasksInStatus = await ctx.db
      .query("tasks")
      .withIndex("by_project_status_position", (q) =>
        q.eq("projectId", job.projectId).eq("statusId", defaultStatus._id),
      )
      .collect();
    const lastTask = tasksInStatus.length > 0
      ? tasksInStatus.reduce((max, t) =>
          (t.position ?? "") > (max.position ?? "") ? t : max,
        )
      : null;
    const position = generateKeyBetween(lastTask?.position ?? null, null);

    const taskNumber = job.numberRangeStart + rowIndex;

    // The CSV column is "tags" (user-facing), but the underlying task field
    // is still `labels` (denormalized storage that syncs into `tags` /
    // `taskTags`). syncTaskTags is the source of truth for tag membership.
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const taskId = await db.insert("tasks", {
      projectId: job.projectId,
      workspaceId: job.workspaceId,
      title: row.title,
      statusId: defaultStatus._id,
      priority: row.priority ?? "medium",
      labels: row.tags ?? undefined,
      completed: defaultStatus.isCompleted,
      creatorId: job.creatorId,
      position,
      number: taskNumber,
      dueDate: row.dueDate ?? undefined,
      plannedStartDate: row.plannedStartDate ?? undefined,
      estimate: row.estimate ?? undefined,
      importJobId: jobId,
    });

    if (row.tags && row.tags.length > 0) {
      const normalized = await syncTaskTags(ctx, {
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        taskId,
        completed: defaultStatus.isCompleted,
        dueDate: row.dueDate ?? undefined,
        plannedStartDate: row.plannedStartDate ?? undefined,
        assigneeId: undefined,
        nextTagNames: row.tags,
      });
      if (
        normalized.length !== row.tags.length ||
        normalized.some((t: string, i: number) => t !== row.tags![i])
      ) {
        await db.patch(taskId, { labels: normalized });
      }
    }

    await logTaskActivity(ctx, {
      taskId,
      userId: job.creatorId,
      workspaceId: job.workspaceId,
      type: "created",
      taskTitle: row.title,
    });

    await ctx.db.patch(jobId, {
      processedRows: job.processedRows + 1,
    });
    return null;
  },
});

// ── helpers ─────────────────────────────────────────────────────────────

import type { Doc } from "./_generated/dataModel";

/**
 * Strip the bulky `rows` payload from anything we send to clients. The
 * row blob is only meaningful to the workpool action — the status page
 * reads the tasks the job produced via listJobTasks.
 */
function projectActiveJob(job: Doc<"taskImportJobs">) {
  const { rows: _omitted, ...rest } = job;
  void _omitted;
  return rest;
}
