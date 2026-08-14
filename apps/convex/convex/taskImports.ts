// CSV-driven bulk task import.
//
// Flow:
//   client parses CSV with papaparse → validates with @shared/taskImportSchema
//   → calls createImportJob → mutation reserves a task-number range, persists
//   the job doc, enqueues runImport on the taskImportPool
//   → workpool action calls createImportedTasks once per batch of rows
//
// Validation lives at two layers that share one zod schema:
//   1. Loose convex args (`rows: v.array(v.any())`) — keeps old job docs
//      readable as the CSV format evolves; no schema migrations on column add.
//   2. Strict zod (`taskImportRowSchema`) — applied client-side, again in
//      createImportJob defensively, and once more in createImportedTasks
//      before each insert so a single bad row doesn't abort the job.

import { ConvexError, v } from "convex/values";
import { internalAction, query } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { generateKeyBetween } from "fractional-indexing";
import { logTaskActivity } from "./auditLog";
import { requireWorkspaceMember, checkResourceMember } from "./authHelpers";
import { syncTaskTags } from "./tagSync";
import { enrichedTaskValidator, hasBlockingEdge } from "./tasks";
import { scheduleTaskImport } from "./taskImportPool";
import { isImportJobStale } from "./taskImportStaleness";
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
  // `projectActiveJob` strips only the heavy `rows` blob, so every other
  // column on the row reaches this validator and has to be declared here —
  // omitting one makes the *query* throw, not just drop the field.
  lastProgressAt: v.optional(v.number()),
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
 * Latest queued-or-running import for the project that is actually still
 * moving, or null.
 *
 * Drives both the Import button's disabled state and the active-import
 * banner. Returns a minimal projection — the full row payload is never sent
 * to the client (it's only meaningful to the workpool action).
 *
 * A stale row is treated as absent rather than patched away, because this is a
 * query and cannot write. The row is tidied up separately by
 * `expireStaleImportJobs` on a cron; reading past it here is what makes the
 * banner clear immediately instead of on the cron's schedule.
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
    if (queued && !isImportJobStale(queued)) return projectActiveJob(queued);

    const running = await ctx.db
      .query("taskImportJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "running"),
      )
      .order("desc")
      .first();
    if (running && !isImportJobStale(running)) return projectActiveJob(running);

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
        return {
          ...task,
          status,
          assignee,
          projectKey: project.key,
          hasBlockers: await hasBlockingEdge(ctx, task._id),
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

    // Concurrency guard: at most one *live* queued/running job per project. A
    // job that has gone quiet is presumed dead and does not hold the lock —
    // without that, one dead drain took the project's import feature with it
    // permanently, since nothing else could move the row off `queued`.
    const queuedJob = await ctx.db
      .query("taskImportJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", projectId).eq("status", "queued"),
      )
      .first();
    const activeQueued = queuedJob && !isImportJobStale(queuedJob) ? queuedJob : null;
    const runningJob = activeQueued
      ? null
      : await ctx.db
          .query("taskImportJobs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", projectId).eq("status", "running"),
          )
          .first();
    const activeRunning =
      runningJob && !isImportJobStale(runningJob) ? runningJob : null;
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
 * Rows applied per mutation. The same size the GitHub import drain pages at,
 * and for the same reason: it is the largest batch whose per-row work (task
 * insert + tag sync + audit entry, each with its triggers) comfortably fits one
 * transaction.
 *
 * The batch is what makes the import affordable. The CSV payload lives inline
 * on the job row (`rows`, up to Convex's 1MB document limit), so a mutation
 * that opens with `ctx.db.get(jobId)` reads the whole blob and one that patches
 * the job rewrites it — one mutation per row therefore moved O(rows x payload)
 * bytes in each direction to create O(rows) small tasks. Bytes read and written
 * are the billed and rate-limited resources, so a single mid-size import used
 * to dominate the deployment's budget. Batching divides both by BATCH_SIZE.
 */
const IMPORT_BATCH_SIZE = 50;

/**
 * Batched task creation. The action is the orchestrator; each batch is one
 * internal mutation so a failure can't roll back the whole job's writes.
 *
 * Row-level isolation is preserved where it actually applies: an unparseable
 * row is detected before any write and counted, so bad data never costs its
 * neighbours. A batch that throws is the rare rest — infra, or a project
 * missing its statuses — and rolls back cleanly rather than leaving
 * half-written tasks behind, with the action booking the whole batch as failed.
 */
export const runImport = internalAction({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const startResult = await ctx.runMutation(internal.taskImports.startJob, { jobId });
    if (!startResult) return null;
    const { totalRows } = startResult;

    for (let startIndex = 0; startIndex < totalRows; startIndex += IMPORT_BATCH_SIZE) {
      const count = Math.min(IMPORT_BATCH_SIZE, totalRows - startIndex);
      try {
        await ctx.runMutation(internal.taskImports.createImportedTasks, {
          jobId,
          startIndex,
          count,
        });
      } catch (err) {
        // createImportedTasks swallows per-row data failures into the job's
        // failedRows counter, so reaching here means the mutation itself threw
        // uncaught and none of its writes landed. Book the batch as failed
        // rather than aborting the whole job.
        console.error("taskImports.runImport batch failure", { jobId, startIndex, count, err });
        await ctx.runMutation(internal.taskImports.recordRowFailures, { jobId, count });
      }
    }

    await ctx.runMutation(internal.taskImports.finalizeJob, { jobId });
    return null;
  },
});

/**
 * Retire an import the caller knows is not coming back.
 *
 * Staleness clears a wedge on its own, but only after the liveness window, and
 * the person watching a stuck banner is the one who already knows the import
 * died. Scoped to project members rather than admins: this destroys no data —
 * the tasks a partial import created stay — it only moves a job off a status
 * that is lying about it.
 *
 * Terminal jobs are refused rather than ignored, so "cancel" can never reopen
 * a completed import or overwrite the reason a failed one gives.
 */
export const cancelImportJob = mutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new ConvexError("Import job not found");

    const auth = await checkResourceMember(ctx, "projects", job.projectId);
    if (!auth) throw new ConvexError("Not authorized to cancel this import");

    if (job.status !== "queued" && job.status !== "running") {
      throw new ConvexError("This import has already finished");
    }

    await ctx.db.patch(jobId, {
      status: "failed",
      errorMessage: "Import cancelled",
      completedAt: Date.now(),
    });
    return null;
  },
});

// ── Internal mutations ─────────────────────────────────────────────────

/**
 * Retire import jobs that stopped making progress, so the row stops claiming
 * to be busy.
 *
 * The readers already treat a stale job as absent, which is what unblocks the
 * project immediately; this is the other half — without it a dead job sits at
 * `queued` forever, indistinguishable in the data from one still waiting its
 * turn, and every list of "imports for this project" misreports it.
 *
 * Bounded per run rather than paginated to completion: the population is jobs
 * that died, which is small, and a sweep that falls behind catches up on the
 * next tick.
 */
export const expireStaleImportJobs = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const status of ["queued", "running"] as const) {
      const candidates = await ctx.db
        .query("taskImportJobs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(EXPIRY_SWEEP_LIMIT);

      for (const job of candidates) {
        if (!isImportJobStale(job)) continue;
        await ctx.db.patch(job._id, {
          status: "failed",
          errorMessage:
            "Import stopped making progress and was presumed abandoned",
          completedAt: Date.now(),
        });
      }
    }
    return null;
  },
});

const EXPIRY_SWEEP_LIMIT = 100;

export const startJob = internalMutation({
  args: { jobId: v.id("taskImportJobs") },
  returns: v.union(v.object({ totalRows: v.number() }), v.null()),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.status !== "queued") return { totalRows: job.totalRows };
    await ctx.db.patch(jobId, { status: "running", lastProgressAt: Date.now() });
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

/** Book a batch the mutation never committed as processed-and-failed. */
export const recordRowFailures = internalMutation({
  args: { jobId: v.id("taskImportJobs"), count: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, count }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    await ctx.db.patch(jobId, {
      processedRows: job.processedRows + count,
      lastProgressAt: Date.now(),
      failedRows: job.failedRows + count,
    });
    return null;
  },
});

/**
 * Create tasks from a contiguous slice of the job's stored rows. Mirrors
 * `tasks.create` but:
 *   - uses the pre-reserved task number (numberRangeStart + rowIndex)
 *     instead of incrementing project.taskCounter,
 *   - records per-row parse failures in the job rather than throwing,
 *   - tags each new task with `importJobId` so the status page can list it,
 *   - skips assignment notifications (no assignee in v1).
 *
 * Everything the rows share — the job document, the project, the default
 * status, the tail of the status column — is read ONCE for the batch. That is
 * the whole point: the job read carries the entire CSV payload with it, so
 * hoisting it out of the row loop is what removes the amplification, and the
 * single closing patch is what stops the payload being rewritten per row.
 */
export const createImportedTasks = internalMutation({
  args: {
    jobId: v.id("taskImportJobs"),
    startIndex: v.number(),
    count: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, startIndex, count }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;

    const finish = (failedRows: number) =>
      ctx.db.patch(jobId, {
        processedRows: job.processedRows + count,
        failedRows: job.failedRows + failedRows,
        lastProgressAt: Date.now(),
      });

    const project = await ctx.db.get(job.projectId);
    if (!project) {
      await finish(count);
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
    // Index order is position order, so the column maximum is its last row.
    // Collecting the column instead made the import O(N**2) and put a hard
    // read-cap failure at ~10k tasks in one column. Read once per batch and
    // chained forward from there — re-reading the tail per row would return
    // this batch's own previous insert anyway.
    const lastTask = await ctx.db
      .query("tasks")
      .withIndex("by_project_status_position", (q) =>
        q.eq("projectId", job.projectId).eq("statusId", defaultStatus._id),
      )
      .order("desc")
      .first();
    let previousPosition = lastTask?.position ?? null;

    let failedRows = 0;

    for (let offset = 0; offset < count; offset++) {
      const rowIndex = startIndex + offset;

      // Third validation pass — structural check on the already-parsed row
      // we persisted. Uses the output schema (typed values, no coercion) so
      // it doesn't re-reject a `labels: string[]` that the input schema
      // would only accept as a raw `string`. Catches storage corruption and
      // the case where the running version's schema is tighter than the one
      // that originally accepted the row. Runs before any write, which is what
      // keeps a bad row from costing the rest of its batch.
      const parsed = taskImportRowOutputSchema.safeParse(job.rows[rowIndex]);
      if (!parsed.success) {
        failedRows++;
        continue;
      }
      const row = parsed.data;

      const position = generateKeyBetween(previousPosition, null);
      previousPosition = position;

      // The CSV column is "tags" (user-facing), but the underlying task field
      // is still `labels` (denormalized storage that syncs into `tags` /
      // `taskTags`). syncTaskTags is the source of truth for tag membership.
      const taskId = await ctx.db.insert("tasks", {
        projectId: job.projectId,
        workspaceId: job.workspaceId,
        title: row.title,
        statusId: defaultStatus._id,
        priority: row.priority ?? "medium",
        labels: row.tags ?? undefined,
        completed: defaultStatus.isCompleted,
        creatorId: job.creatorId,
        position,
        number: job.numberRangeStart + rowIndex,
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
          await ctx.db.patch(taskId, { labels: normalized });
        }
      }

      await logTaskActivity(ctx, {
        taskId,
        userId: job.creatorId,
        workspaceId: job.workspaceId,
        type: "created",
        taskTitle: row.title,
      });
    }

    await finish(failedRows);
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
