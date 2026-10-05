import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { CycleStatus } from "@ripple/shared/types/cycles";
import { logActivity } from "../auditLog";

/**
 * The rules every cycle write shares, kept out of `cycles.ts` because
 * `tasks.ts` needs them too and `cycles.ts` already imports from `tasks.ts`.
 *
 * The model: a task is in at most one cycle (`tasks.cycleId`), and no cycle at
 * all means the backlog. Cycles are opened and closed by hand — their dates
 * are informational and never move `status`.
 */

/**
 * Read a cycle's status as the two-state model. Rows written before
 * `migrateCyclesToBacklogModel` still carry the four date-derived literals;
 * only `completed` among them meant "done".
 */
export function cycleStatusOf(cycle: Pick<Doc<"cycles">, "status">): CycleStatus {
  return cycle.status === "closed" || cycle.status === "completed" ? "closed" : "open";
}

/**
 * Load a cycle a caller wants to put tasks into. The caller authorized the
 * PROJECT (or a task in it); the cycle id is a second caller-supplied id the
 * gate never saw, so it must be checked against that project — otherwise a
 * task is filed into another workspace's cycle and that cycle's progress
 * counts it.
 */
export async function assertOpenCycleInProject(
  ctx: MutationCtx,
  cycleId: Id<"cycles">,
  projectId: Id<"projects">,
): Promise<Doc<"cycles">> {
  const cycle = await ctx.db.get(cycleId);
  if (!cycle) throw new ConvexError("Cycle not found");
  if (cycle.projectId !== projectId) {
    throw new ConvexError("Cycle does not belong to this project");
  }
  if (cycleStatusOf(cycle) === "closed") {
    throw new ConvexError("Cycle is closed — reopen it first");
  }
  return cycle;
}

/**
 * Move one task to `target` (a cycle already checked by
 * `assertOpenCycleInProject`, or `null` for the backlog). Returns whether the
 * task actually moved. Logged on the cycle side, as `task_added` /
 * `task_removed`, so a cycle's timeline shows what was planned in and out.
 */
export async function moveTaskToCycle(
  ctx: MutationCtx,
  args: {
    task: Doc<"tasks">;
    target: Doc<"cycles"> | null;
    userId: Id<"users">;
  },
): Promise<boolean> {
  const { task, target, userId } = args;
  if (target && target.projectId !== task.projectId) {
    throw new ConvexError("Task does not belong to this cycle's project");
  }
  const targetId = target?._id;
  if (task.cycleId === targetId) return false;

  const source = task.cycleId ? await ctx.db.get(task.cycleId) : null;
  await ctx.db.patch(task._id, { cycleId: targetId });

  if (source) {
    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: source._id,
      action: "task_removed", oldValue: task.title,
      resourceName: source.name, scope: source.workspaceId,
    });
  }
  if (target) {
    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: target._id,
      action: "task_added", newValue: task.title,
      resourceName: target.name, scope: target.workspaceId,
    });
  }
  return true;
}

/** Name for the next cycle a project gets: one past the number of cycles it has. */
export async function nextCycleName(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<string> {
  // A project's cycles are a handful per quarter, not an unbounded set.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const existing = await ctx.db
    .query("cycles")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return `Cycle ${existing.length + 1}`;
}
