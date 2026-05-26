import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { applyStatusSideEffects } from "../../taskStatusSideEffects";
import { logTaskIntegrationActivity } from "./integrationActivity";

/**
 * Single arbiter for GitHub-driven task status changes. Every inbound signal
 * (issue close/reopen, PR open/merge, branch-rule merges) routes through
 * `reconcileTaskStatus`, which is the *only* place that decides a linked task's
 * status and applies it. Consolidating the decision here removes the previous
 * split where `syncIn` (close/reopen) and `pullRequestAutomation` (PR signals)
 * each patched `statusId` independently and coordinated precedence via an
 * inline cross-module guard.
 *
 * Per-trigger semantics (deliberately different — this is not a uniform
 * "derive desired state" model):
 *  - `pr.changed`   → highest-`order` PR signal, **forward-only** (a PR can
 *    only advance a task, never demote it).
 *  - `issue.closed` → resolved completed status, **suppressed when a branch
 *    rule governs** (a merged PR into a mapped branch is authoritative); not
 *    forward-only.
 *  - `issue.reopened` → triage, unconditional (intentionally moves backward).
 */
export type ReconcileTrigger =
  | { kind: "issue.closed"; stateReason: "completed" | "not_planned" }
  | { kind: "issue.reopened" }
  | { kind: "pr.changed" };

type Decision = { target: Doc<"taskStatuses">; forwardOnly: boolean };

export async function reconcileTaskStatus(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  trigger: ReconcileTrigger,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;

  const decision = await decideStatus(ctx, task, trigger);
  if (!decision) return;

  await applyResolvedStatus(ctx, task, decision.target, decision.forwardOnly);
}

async function decideStatus(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  trigger: ReconcileTrigger,
): Promise<Decision | null> {
  switch (trigger.kind) {
    case "pr.changed": {
      const candidate = await deriveDesiredStatus(ctx, task);
      return candidate ? { target: candidate, forwardOnly: true } : null;
    }
    case "issue.reopened": {
      return {
        target: await resolveTriageStatus(ctx, task.projectId),
        forwardOnly: false,
      };
    }
    case "issue.closed": {
      // Precedence: when a merged PR's target branch matches a branch→status
      // rule, that transition is authoritative — suppress the generic
      // issue-close completion (it would downgrade the branch-mapped status).
      if (await taskHasBranchRuleMatch(ctx, task._id)) return null;
      return {
        target: await resolveCompletedStatus(ctx, task.projectId, trigger.stateReason),
        forwardOnly: false,
      };
    }
  }
}

/**
 * Apply a resolved status to a task. No-op when it's already the current
 * status, or — under `forwardOnly` — when the target isn't strictly later (by
 * `order`) than the current status. Mirrors the canonical status-change side
 * effects: syncs `completed` and opens/closes a work period.
 */
async function applyResolvedStatus(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  target: Doc<"taskStatuses">,
  forwardOnly: boolean,
): Promise<void> {
  if (target._id === task.statusId) return;
  const current = await ctx.db.get(task.statusId);
  if (forwardOnly) {
    if (current && current.order >= target.order) return;
  }
  await ctx.db.patch(task._id, {
    statusId: target._id,
    ...applyStatusSideEffects(task, target),
  });

  // Record the integration-driven status move on the task timeline — this is
  // the high-value event: a status change with no Ripple actor (a merged PR or
  // a closed issue moved it), which would otherwise be invisible in history.
  await logTaskIntegrationActivity(ctx, {
    taskId: task._id,
    type: "status_synced",
    oldValue: current?.name,
    newValue: target.name,
  });
}

// ─── status resolvers (shared with createTaskFromEvent) ──────────────────

/**
 * The project's triage status. Throws when the project has none — every
 * project is provisioned with one, so its absence is a real invariant
 * violation rather than a recoverable case.
 */
export async function resolveTriageStatus(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<Doc<"taskStatuses">> {
  const triage = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project_isTriage", (q) =>
      q.eq("projectId", projectId).eq("isTriage", true),
    )
    .unique();
  if (!triage) {
    throw new Error(`reconcileTaskStatus: project ${projectId} has no triage status`);
  }
  return triage;
}

/**
 * The destination completed status for an inbound `issue.closed`:
 *  - `not_planned` → first `isCompleted` status with
 *    `externalCloseReason='not_planned'` by `order`, falling back to the
 *    default-completed routing when none is configured.
 *  - `completed` (or any other) → first `isCompleted` status by `order`.
 */
export async function resolveCompletedStatus(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  stateReason: "completed" | "not_planned",
): Promise<Doc<"taskStatuses">> {
  if (stateReason === "not_planned") {
    const notPlanned = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_isCompleted_closeReason_order", (q) =>
        q
          .eq("projectId", projectId)
          .eq("isCompleted", true)
          .eq("externalCloseReason", "not_planned"),
      )
      .first();
    if (notPlanned) return notPlanned;
    // Fall through to the default-completed routing.
  }

  const completed = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project_isCompleted_order", (q) =>
      q.eq("projectId", projectId).eq("isCompleted", true),
    )
    .first();
  if (!completed) {
    throw new Error(`reconcileTaskStatus: project ${projectId} has no completed status`);
  }
  return completed;
}

// ─── PR signal resolution ────────────────────────────────────────────────

/** A PR still represents in-flight work (vs. merged/closed-unmerged). */
function isActive(state: Doc<"pullRequests">["state"]): boolean {
  return state === "draft" || state === "open";
}

/**
 * The status a task's linked PRs nominate, or `undefined` for "no change".
 * Returns the highest-`order` candidate among all PR signals: any active
 * (draft/open) PR nominates the project's start status; a merge into a mapped
 * branch nominates that branch's status.
 */
async function deriveDesiredStatus(
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
 * Whether the task has a merged PR whose target branch matches a branch→status
 * rule. The `issue.closed` path consults this to defer to the branch rule: when
 * true, the merge-driven transition is authoritative and issue-close completion
 * is suppressed (it would otherwise downgrade the task to the generic completed
 * status). Returns false when no rule governs, letting issue-close act as the
 * fallback.
 */
async function taskHasBranchRuleMatch(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
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
 * The status a merged PR's target branch maps to under its link's
 * `branchStatusMap`, or `undefined` when the branch isn't mapped (or the mapped
 * status no longer exists). Exact branch-name match.
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
 * The project's start status: the lowest-`order` status flagged `setsStartDate`.
 * Returns `undefined` when the project defines none.
 */
async function resolveStartedStatus(
  ctx: MutationCtx,
  projectId: Id<"projects">,
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
