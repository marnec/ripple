import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * PR-driven task status automation. Forward-only and most-advanced-wins by
 * `status.order`: a PR signal can only ever advance a task, never revert or
 * demote it, and a task already at/after the candidate status (or completed)
 * is left untouched.
 *
 * Phase 3 wires a single signal: any *active* (draft/open) PR linked to the
 * task nominates the project's start status (the `setsStartDate` one). Phase 4
 * adds branch→status merge signals to the same ranking.
 */

/** A PR still represents in-flight work (vs. merged/closed-unmerged). */
function isActive(state: Doc<"pullRequests">["state"]): boolean {
  return state === "draft" || state === "open";
}

/**
 * The status a task's linked PRs nominate, or `undefined` for "no change".
 * Returns the highest-`order` candidate among all PR signals.
 */
export async function deriveDesiredStatus(
  ctx: MutationCtx,
  task: Doc<"tasks">,
): Promise<Doc<"taskStatuses"> | undefined> {
  const joins = await ctx.db
    .query("taskPullRequestLinks")
    .withIndex("by_task", (q) => q.eq("taskId", task._id))
    .collect();

  let hasActivePr = false;
  for (const join of joins) {
    const pr = await ctx.db.get(join.pullRequestId);
    if (pr && isActive(pr.state)) hasActivePr = true;
  }

  let candidate: Doc<"taskStatuses"> | undefined;
  if (hasActivePr) {
    const started = await resolveStartedStatus(ctx, task.projectId);
    if (started) candidate = maxByOrder(candidate, started);
  }
  return candidate;
}

/**
 * Apply the PR-derived status to a task, forward-only. No-op when the task is
 * completed, when no PR signal applies, or when the candidate isn't strictly
 * later than the task's current status. Mirrors the canonical status-change
 * side effects: syncs `completed` and opens/closes a work period.
 */
export async function applyPullRequestStatusAutomation(
  ctx: MutationCtx,
  taskId: Doc<"tasks">["_id"],
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;
  // Forward-only never disturbs a completed task.
  if (task.completed) return;

  const candidate = await deriveDesiredStatus(ctx, task);
  if (!candidate) return;
  if (candidate._id === task.statusId) return;

  const current = await ctx.db.get(task.statusId);
  if (current && current.order >= candidate.order) return; // forward-only

  const patch: Partial<Doc<"tasks">> = {
    statusId: candidate._id,
    completed: candidate.isCompleted,
  };

  const periods = task.workPeriods ?? [];
  const openPeriod = periods.find((p) => p.completedAt === undefined);
  if (candidate.setsStartDate && !openPeriod) {
    patch.workPeriods = [...periods, { startedAt: Date.now() }];
  } else if (candidate.isCompleted && openPeriod) {
    patch.workPeriods = periods.map((p) =>
      p.completedAt === undefined ? { ...p, completedAt: Date.now() } : p,
    );
  }

  await ctx.db.patch(taskId, patch);
}

/**
 * The project's start status: the lowest-`order` status flagged
 * `setsStartDate`. Returns `undefined` when the project defines none, so the
 * start nudge degrades to a clean no-op.
 */
async function resolveStartedStatus(
  ctx: MutationCtx,
  projectId: Doc<"tasks">["projectId"],
): Promise<Doc<"taskStatuses"> | undefined> {
  const statuses = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
    .collect();
  return statuses.find((s) => s.setsStartDate === true);
}

function maxByOrder(
  a: Doc<"taskStatuses"> | undefined,
  b: Doc<"taskStatuses">,
): Doc<"taskStatuses"> {
  if (!a) return b;
  return b.order > a.order ? b : a;
}
