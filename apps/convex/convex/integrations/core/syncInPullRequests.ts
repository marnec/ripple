import type { MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getWorkspaceIntegration } from "./integrationLookups";
import type { NormalizedPullRequestEvent } from "./types";

/**
 * Apply a provider-neutral pull-request event to Ripple state. Called from a
 * provider webhook adapter after the closing references have been resolved
 * (so `event.closesExternalIssueIds` carries stable issue ids), and after
 * workspace/link resolution + the freeze gate have run — so this may assume
 * the link is sync-active.
 *
 * A PR is an attachment, not a task: this upserts the canonical `pullRequests`
 * row and attaches it (via `taskPullRequestLinks`) to whichever closed issues
 * Ripple already imported. No task status automation here (Phase 3+).
 */
export async function applyPullRequestEvent(
  ctx: MutationCtx,
  args: {
    event: NormalizedPullRequestEvent;
    link: Doc<"projectIntegrationLinks">;
  },
): Promise<void> {
  const { event, link } = args;

  // Idempotency: a redelivered open for a PR we already track is a no-op.
  const existing = await ctx.db
    .query("pullRequests")
    .withIndex("by_link_externalPrId", (q) =>
      q
        .eq("projectIntegrationLinkId", link._id)
        .eq("externalPrId", event.externalPrId),
    )
    .unique();
  if (existing) return;

  const integration = await getWorkspaceIntegration(ctx, link.workspaceId);
  if (!integration) {
    throw new Error(
      `applyPullRequestEvent: workspace ${link.workspaceId} has no integration row`,
    );
  }

  // Resolve which closed issues Ripple actually imported. A PR with no
  // resolvable task is dropped — we don't store PRs that attach to nothing.
  const taskIds: Doc<"tasks">["_id"][] = [];
  for (const externalIssueId of event.closesExternalIssueIds) {
    const taskLink = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q
          .eq("projectIntegrationLinkId", link._id)
          .eq("externalIssueId", externalIssueId),
      )
      .unique();
    if (taskLink) taskIds.push(taskLink.taskId);
  }
  if (taskIds.length === 0) return;

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
  });

  for (const taskId of taskIds) {
    await ctx.db.insert("taskPullRequestLinks", { taskId, pullRequestId });
  }
}
