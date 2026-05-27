import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getIntegrationForLink } from "./integrationLookups";
import { logTaskIntegrationActivity } from "./integrationActivity";
import { reconcileTaskStatus } from "./statusReconciliation";
import type { NormalizedPullRequestEvent } from "./types";

/** Human-readable PR label for activity entries, e.g. `#7 Fix login`. */
function prLabel(number: number, title: string): string {
  return `#${number} ${title}`;
}

/**
 * Apply a provider-neutral pull-request event to Ripple state. Called from a
 * provider webhook adapter after the closing references have been resolved
 * (so `event.closesExternalIssueIds` carries stable issue ids), and after
 * workspace/link resolution + the freeze gate have run — so this may assume
 * the link is sync-active.
 *
 * A PR is an attachment, not a task: this upserts the canonical `pullRequests`
 * row and reconciles its `taskPullRequestLinks` joins to whichever closed
 * issues Ripple already imported. Full-state + ordering-guarded, so it's
 * idempotent against missed/out-of-order deliveries. No task status
 * automation here (Phase 3+).
 */
export async function applyPullRequestEvent(
  ctx: MutationCtx,
  args: {
    event: NormalizedPullRequestEvent;
    link: Doc<"projectIntegrationLinks">;
  },
): Promise<void> {
  const { event, link } = args;

  const existing = await ctx.db
    .query("pullRequests")
    .withIndex("by_link_externalPrId", (q) =>
      q
        .eq("projectIntegrationLinkId", link._id)
        .eq("externalPrId", event.externalPrId),
    )
    .unique();

  const taskIds = await resolveTaskIds(
    ctx,
    link,
    event.closesExternalIssueIds,
    // Tolerate events from before this field existed (in-flight redeliveries)
    // or any `v.any()` passthrough that omits it.
    event.closesIssueNumbers ?? [],
  );

  if (!existing) {
    // Don't store a PR that attaches to nothing Ripple imported.
    if (taskIds.length === 0) return;

    const integration = await getIntegrationForLink(ctx, link);
    if (!integration) {
      throw new Error(
        `applyPullRequestEvent: workspace ${link.workspaceId} has no integration row`,
      );
    }

    const pullRequestId = await ctx.db.insert("pullRequests", {
      workspaceId: link.workspaceId,
      projectIntegrationLinkId: link._id,
      provider: integration.provider,
      externalPrId: event.externalPrId,
      number: event.number,
      title: event.title,
      url: event.url,
      state: event.state,
      headRef: event.headRef,
      baseRef: event.baseRef,
      externalAuthor: event.externalAuthor,
      externalUpdatedAt: event.externalUpdatedAt,
      mergedAt: event.mergedAt,
    });
    for (const taskId of taskIds) {
      await ctx.db.insert("taskPullRequestLinks", { taskId, pullRequestId });
      await logTaskIntegrationActivity(ctx, {
        taskId,
        type: "pr_linked",
        newValue: prLabel(event.number, event.title),
      });
      await recomputePullRequestState(ctx, taskId);
      await reconcileTaskStatus(ctx, taskId, { kind: "pr.changed" });
    }
    return;
  }

  // Ordering guard: an event not strictly newer than what we've recorded is a
  // stale or redelivered payload — drop it (idempotent).
  if (event.externalUpdatedAt <= existing.externalUpdatedAt) return;

  const stateChanged = existing.state !== event.state;

  await ctx.db.patch(existing._id, {
    title: event.title,
    url: event.url,
    state: event.state,
    headRef: event.headRef,
    baseRef: event.baseRef,
    externalUpdatedAt: event.externalUpdatedAt,
    mergedAt: event.mergedAt,
  });

  // Reconcile the join set against the current closing references: attach
  // newly-referenced tasks, detach ones the PR no longer closes.
  const currentJoins = await ctx.db
    .query("taskPullRequestLinks")
    .withIndex("by_pullRequest", (q) => q.eq("pullRequestId", existing._id))
    .collect();
  const currentTaskIds = new Set(currentJoins.map((j) => j.taskId));
  const nextTaskIds = new Set(taskIds);

  for (const join of currentJoins) {
    if (!nextTaskIds.has(join.taskId)) {
      await ctx.db.delete(join._id);
      await logTaskIntegrationActivity(ctx, {
        taskId: join.taskId,
        type: "pr_unlinked",
        oldValue: prLabel(existing.number, event.title),
      });
    }
  }
  for (const taskId of nextTaskIds) {
    if (!currentTaskIds.has(taskId)) {
      await ctx.db.insert("taskPullRequestLinks", {
        taskId,
        pullRequestId: existing._id,
      });
      await logTaskIntegrationActivity(ctx, {
        taskId,
        type: "pr_linked",
        newValue: prLabel(event.number, event.title),
      });
    }
  }

  // Log the notable terminal transitions (merge / close) once per still-linked
  // task. Draft↔open churn is intentionally not logged — it's noise, and the
  // folded PR summary already shows the live state.
  if (stateChanged && (event.state === "merged" || event.state === "closed")) {
    const transitionType =
      event.state === "merged" ? "pr_merged" : "pr_closed";
    for (const taskId of nextTaskIds) {
      await logTaskIntegrationActivity(ctx, {
        taskId,
        type: transitionType,
        newValue: prLabel(event.number, event.title),
      });
    }
  }

  // Recompute the denormalized state for every task touched by this event —
  // both those still attached (their PR's state may have changed) and those
  // just detached (which may now have no PRs).
  const affected = new Set<Doc<"tasks">["_id"]>([
    ...currentTaskIds,
    ...nextTaskIds,
  ]);
  for (const taskId of affected) {
    await recomputePullRequestState(ctx, taskId);
    await reconcileTaskStatus(ctx, taskId, { kind: "pr.changed" });
  }
}

/** Display ranking — the "furthest along" PR wins the task's indicator. */
const STATE_RANK: Record<Doc<"pullRequests">["state"], number> = {
  closed: 1,
  draft: 2,
  open: 3,
  merged: 4,
};

/**
 * Recompute `tasks.pullRequestState` from the task's current linked PRs:
 * the most-advanced state by `STATE_RANK`, or `undefined` when none remain.
 * Patches only on change to avoid needless hot-row subscription churn.
 */
async function recomputePullRequestState(
  ctx: MutationCtx,
  taskId: Doc<"tasks">["_id"],
): Promise<void> {
  const joins = await ctx.db
    .query("taskPullRequestLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();

  let best: Doc<"pullRequests">["state"] | undefined;
  for (const join of joins) {
    const pr = await ctx.db.get(join.pullRequestId);
    if (!pr) continue;
    if (best === undefined || STATE_RANK[pr.state] > STATE_RANK[best]) {
      best = pr.state;
    }
  }

  const task = await ctx.db.get(taskId);
  if (task && task.pullRequestState !== best) {
    await ctx.db.patch(taskId, { pullRequestState: best });
  }
}

async function resolveTaskIds(
  ctx: MutationCtx,
  link: Doc<"projectIntegrationLinks">,
  closesExternalIssueIds: string[],
  closesIssueNumbers: number[],
): Promise<Doc<"tasks">["_id"][]> {
  const taskIds = new Set<Doc<"tasks">["_id"]>();

  // Node-id path: GitHub's resolved closing graph. Populated only for PRs
  // targeting the repo's default branch, but keyed on the stable id so it's
  // exact when present.
  for (const externalIssueId of closesExternalIssueIds) {
    const taskLink = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q
          .eq("projectIntegrationLinkId", link._id)
          .eq("externalIssueId", externalIssueId),
      )
      .unique();
    if (taskLink) taskIds.add(taskLink.taskId);
  }

  // Number path: keywords parsed from the PR text, branch-independent. This is
  // what keeps branch→status automation working when a PR merges into a
  // non-default branch like `develop`. Resolved via the `taskExternalRefs`
  // lookup table (a denormalized projection of `tasks.externalRefs`, kept in
  // sync by a dbTriggers hook) so it's a point index lookup per referenced
  // issue rather than a scan of every task in the project on each webhook —
  // the issue number can't be indexed on `tasks` itself (nested array).
  for (const issueNumber of new Set(closesIssueNumbers)) {
    const refs = await ctx.db
      .query("taskExternalRefs")
      .withIndex("by_project_repo_issue", (q) =>
        q
          .eq("projectId", link.projectId)
          .eq("repoFullName", link.externalRepoFullName)
          .eq("issueNumber", issueNumber),
      )
      .collect();
    for (const ref of refs) taskIds.add(ref.taskId);
  }

  return [...taskIds];
}
