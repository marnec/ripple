import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * PR-driven task status automation. Forward-only and most-advanced-wins by
 * `status.order`: a PR signal can only ever advance a task, never revert or
 * demote it, and a task already at/after the candidate status is left
 * untouched.
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
 * Whether the task has a merged PR whose target branch matches a branch→status
 * rule. The `issues.closed` path consults this to defer to the branch rule:
 * when true, a merge-driven transition is authoritative, so issue-close
 * completion is suppressed (it would otherwise downgrade the task to the
 * generic completed status). Returns false when no rule governs, letting the
 * issue-close completion act as the fallback.
 */
export async function taskHasBranchRuleMatch(
  ctx: MutationCtx,
  taskId: Doc<"tasks">["_id"],
): Promise<boolean> {
  const joins = await ctx.db
    .query("taskPullRequestLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  for (const join of joins) {
    const pr = await ctx.db.get(join.pullRequestId);
    if (pr && pr.state === "merged" && (await resolveBranchStatus(ctx, pr))) {
      return true;
    }
  }
  return false;
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
  let candidate: Doc<"taskStatuses"> | undefined;

  for (const join of joins) {
    const pr = await ctx.db.get(join.pullRequestId);
    if (!pr) continue;
    if (isActive(pr.state)) {
      hasActivePr = true;
    } else if (pr.state === "merged") {
      // Branch→status signal: a merge into a mapped branch nominates that
      // status. Merges into unmapped branches contribute nothing (completion
      // stays delegated to the issues.closed fallback).
      const mapped = await resolveBranchStatus(ctx, pr);
      if (mapped) candidate = maxByOrder(candidate, mapped);
    }
  }

  if (hasActivePr) {
    const started = await resolveStartedStatus(ctx, task.projectId);
    if (started) candidate = maxByOrder(candidate, started);
  }
  return candidate;
}

/**
 * The status a merged PR's target branch maps to under its link's
 * `branchStatusMap`, or `undefined` when the branch isn't mapped (or the
 * mapped status no longer exists). Exact branch-name match.
 */
async function resolveBranchStatus(
  ctx: MutationCtx,
  pr: Doc<"pullRequests">,
): Promise<Doc<"taskStatuses"> | undefined> {
  const link = await ctx.db.get(pr.projectIntegrationLinkId);
  const entry = link?.branchStatusMap?.find((e) => e.branch === pr.baseRef);
  if (!entry) return undefined;
  return (await ctx.db.get(entry.statusId)) ?? undefined;
}

/**
 * Apply the PR-derived status to a task, forward-only. No-op when no PR signal
 * applies or when the candidate isn't strictly later (by `order`) than the
 * task's current status — so the low-order start signal never disturbs a
 * completed task, while a higher-order branch-merge signal can advance one
 * (e.g. Done → Released). Mirrors the canonical status-change side effects:
 * syncs `completed` and opens/closes a work period.
 */
export async function applyPullRequestStatusAutomation(
  ctx: MutationCtx,
  taskId: Doc<"tasks">["_id"],
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;

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
