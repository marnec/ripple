/**
 * Bulk actions from the project list view: delete, move to status, set
 * priority, set assignee, add or remove a tag — over a user-picked set of tasks.
 *
 * `apply` is the whole public surface. It authorizes, validates the operation
 * once up front (so a bad status or a foreign assignee fails in the user's face
 * rather than in a background retry loop), and enqueues `run` on the retried
 * `taskReassignPool`. The drain walks the ids in small batches; each batch is
 * one transaction that pushes every task through the same helper the
 * single-task mutation uses (`applyTaskUpdate` / `deleteTask`), so a bulk edit
 * logs activity, applies status side effects and pushes to linked issues
 * exactly like N single edits would.
 *
 * **Restart safety** (see `taskReassignPool.ts`): a retry replays the drain
 * from the first batch, so each batch skips tasks already in the target state —
 * deleted, already on that status, already carrying that tag. A replayed batch
 * converges to no-ops and logs nothing twice.
 */

import { ConvexError, v, type Infer } from "convex/values";
import { internalAction } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation } from "./functions";
import { checkResourceMemberAs, requireResourceMember } from "./authHelpers";
import { priorityValidator } from "./validators";
import { normalizeTagList } from "./tagSync";
import { scheduleTaskReassign } from "./taskReassignPool";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { notify } from "./utils/notify";
import { assertOpenCycleInProject, moveTaskToCycle } from "./lib/cycleRules";
import {
  applyTaskUpdate,
  assertAssigneeInWorkspace,
  assertNotTriage,
  assertStatusInProject,
  deleteTask,
  type TaskChanges,
} from "./tasks";

/** Most tasks one bulk action may touch. The list view selects from what it shows. */
export const BULK_MAX_TASKS = 500;

/**
 * Tasks per transaction. Small on purpose: every task write fans out through
 * the db triggers, and a delete runs the first step of its cascade inline.
 */
const BULK_BATCH_SIZE = 10;

export const bulkOpValidator = v.union(
  v.object({ kind: v.literal("delete"), closeGithubIssues: v.boolean() }),
  v.object({ kind: v.literal("status"), statusId: v.id("taskStatuses") }),
  v.object({ kind: v.literal("priority"), priority: priorityValidator }),
  v.object({ kind: v.literal("assignee"), assigneeId: v.union(v.id("users"), v.null()) }),
  v.object({ kind: v.literal("addTag"), tag: v.string() }),
  v.object({ kind: v.literal("removeTag"), tag: v.string() }),
  // `null` is the backlog.
  v.object({ kind: v.literal("moveToCycle"), cycleId: v.union(v.id("cycles"), v.null()) }),
);
export type BulkOp = Infer<typeof bulkOpValidator>;

/**
 * Throws if the operation cannot apply to this project. Run at enqueue time for
 * the error the user sees, and again by each batch because the world can move
 * while the drain runs (the status deleted, the assignee removed).
 * Returns the op with its tag normalized.
 */
async function validateOp(
  ctx: MutationCtx,
  project: Doc<"projects">,
  op: BulkOp,
): Promise<BulkOp> {
  switch (op.kind) {
    case "status": {
      const status = await ctx.db.get(op.statusId);
      if (!status || status.pendingDeletion === true) {
        throw new ConvexError("Status not found");
      }
      assertNotTriage(status);
      assertStatusInProject(status, project._id);
      return op;
    }
    case "assignee":
      if (op.assigneeId !== null) {
        await assertAssigneeInWorkspace(ctx, project.workspaceId, op.assigneeId);
      }
      return op;
    case "addTag":
    case "removeTag": {
      const [tag] = normalizeTagList([op.tag]);
      if (tag === undefined) throw new ConvexError("Invalid tag");
      return { ...op, tag };
    }
    case "moveToCycle":
      // Re-run per batch like the others: the cycle may be closed or deleted
      // while the drain runs, and then the rest of the selection stays put.
      if (op.cycleId !== null) {
        await assertOpenCycleInProject(ctx, op.cycleId, project._id);
      }
      return op;
    default:
      return op;
  }
}

/** The per-task change `op` makes, or null when the task is already there. */
function changesFor(
  task: Doc<"tasks">,
  op: Exclude<BulkOp, { kind: "delete" } | { kind: "moveToCycle" }>,
): TaskChanges | null {
  switch (op.kind) {
    case "status":
      return task.statusId === op.statusId ? null : { statusId: op.statusId };
    case "priority":
      return task.priority === op.priority ? null : { priority: op.priority };
    case "assignee":
      return (task.assigneeId ?? null) === op.assigneeId ? null : { assigneeId: op.assigneeId };
    case "addTag": {
      const tags = task.tags ?? [];
      return tags.includes(op.tag) ? null : { tags: [...tags, op.tag] };
    }
    case "removeTag": {
      const tags = task.tags ?? [];
      return tags.includes(op.tag) ? { tags: tags.filter((t) => t !== op.tag) } : null;
    }
  }
}

export const apply = mutation({
  args: {
    projectId: v.id("projects"),
    taskIds: v.array(v.id("tasks")),
    op: bulkOpValidator,
  },
  returns: v.null(),
  handler: async (ctx, { projectId, taskIds, op }) => {
    const { userId, resource: project } = await requireResourceMember(ctx, "projects", projectId);

    const ids = [...new Set(taskIds)];
    if (ids.length === 0) return null;
    if (ids.length > BULK_MAX_TASKS) {
      throw new ConvexError(`Select at most ${BULK_MAX_TASKS} tasks at a time`);
    }

    const validOp = await validateOp(ctx, project, op);

    // Per-task notifications are suppressed in the drain; the new assignee
    // gets this one summary instead of one push per task.
    if (validOp.kind === "assignee" && validOp.assigneeId !== null && validOp.assigneeId !== userId) {
      const user = await ctx.db.get(userId);
      const name = getUserDisplayName(user);
      await notify(ctx, {
        category: "taskAssigned",
        userId,
        userName: name,
        recipientIds: [validOp.assigneeId],
        resourceId: projectId,
        title: `${name} assigned you ${ids.length === 1 ? "a task" : `${ids.length} tasks`}`,
        body: project.name,
        url: `/workspaces/${project.workspaceId}/projects/${projectId}`,
      });
    }

    await scheduleTaskReassign(
      ctx,
      internal.taskBulk.run,
      { kind: `taskBulk:${validOp.kind}`, key: projectId },
      { userId, projectId, taskIds: ids, op: validOp },
    );
    return null;
  },
});

/** The drain: one `applyBatch` per chunk of ids, in order. */
export const run = internalAction({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    taskIds: v.array(v.id("tasks")),
    op: bulkOpValidator,
  },
  returns: v.null(),
  handler: async (ctx, { userId, projectId, taskIds, op }) => {
    for (let i = 0; i < taskIds.length; i += BULK_BATCH_SIZE) {
      const proceed: boolean = await ctx.runMutation(internal.taskBulk.applyBatch, {
        userId,
        projectId,
        taskIds: taskIds.slice(i, i + BULK_BATCH_SIZE),
        op,
      });
      if (!proceed) break;
    }
    return null;
  },
});

/**
 * One transaction of the drain. Returns false when the rest of the drain
 * should be abandoned: the user lost access, or the operation stopped being
 * valid (status deleted, assignee left) — retrying would not change either.
 */
export const applyBatch = internalMutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    taskIds: v.array(v.id("tasks")),
    op: bulkOpValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, projectId, taskIds, op }) => {
    // Re-authorized per batch: the drain carries the user as data, and they
    // may have been removed from the workspace since `apply` ran.
    const access = await checkResourceMemberAs(ctx, "projects", projectId, userId);
    if (!access) return false;

    let targetCycle: Doc<"cycles"> | null = null;
    try {
      await validateOp(ctx, access.resource, op);
      if (op.kind === "moveToCycle" && op.cycleId !== null) {
        targetCycle = await ctx.db.get(op.cycleId);
      }
    } catch (error) {
      if (error instanceof ConvexError) return false;
      throw error;
    }

    for (const taskId of taskIds) {
      const task = await ctx.db.get(taskId);
      // Gone (deleted by a replayed batch or someone else), or not in this
      // project — `apply` authorized the project, not each caller-supplied id.
      if (!task || task.projectId !== projectId) continue;

      if (op.kind === "delete") {
        await deleteTask(ctx, {
          userId,
          task,
          closeGithubIssue: op.closeGithubIssues,
          batched: true,
        });
        continue;
      }

      if (op.kind === "moveToCycle") {
        await moveTaskToCycle(ctx, { task, target: targetCycle, userId });
        continue;
      }

      const changes = changesFor(task, op);
      if (changes === null) continue;
      await applyTaskUpdate(ctx, { userId, task, changes, silent: true });
    }
    return true;
  },
});
