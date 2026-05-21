import { v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import { effectiveLinkStatus } from "../core/entitlements";
import { applyPullRequestEvent } from "../core/syncInPullRequests";
import type { NormalizedPullRequestEvent } from "../core/types";

/**
 * Provider-specific parsing for GitHub `pull_request` deliveries. Mirrors
 * `github/webhook.normalize` but lives in its own module because PR handling
 * needs an extra GraphQL hop (closing-issue resolution) that only an action
 * can perform — so the raw payload and the resolved closing ids are combined
 * here into the provider-neutral event `core/syncInPullRequests` consumes.
 */
interface GithubPrUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface GithubPullRequest {
  node_id: string;
  number: number;
  title: string;
  html_url: string;
  draft: boolean;
  updated_at: string;
  head: { ref: string };
  base: { ref: string };
  user: GithubPrUser;
}

interface GithubPullRequestPayload {
  action: string;
  pull_request: GithubPullRequest;
}

/**
 * Translate a raw `pull_request` payload + adapter-resolved closing issue
 * node ids into a normalized event. Returns `null` for events/actions we
 * don't act on yet (Phase 1: `opened` only).
 */
export function normalizePullRequestPayload(
  eventName: string,
  payload: unknown,
  closesExternalIssueIds: string[],
): NormalizedPullRequestEvent | null {
  if (eventName !== "pull_request") return null;
  const p = payload as GithubPullRequestPayload;
  if (p.action !== "opened") return null;

  const pr = p.pull_request;
  return {
    kind: "pullRequest.opened",
    externalPrId: pr.node_id,
    number: pr.number,
    externalUpdatedAt: Date.parse(pr.updated_at),
    title: pr.title,
    url: pr.html_url,
    state: pr.draft ? "draft" : "open",
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    externalAuthor: {
      login: pr.user.login,
      avatarUrl: pr.user.avatar_url,
      url: pr.user.html_url,
    },
    closesExternalIssueIds,
  };
}

/**
 * Resolve the workspace + active link for a normalized PR event and apply it.
 * Same routing/freeze-gate contract as `github/webhook.handleGithubWebhook`:
 * unknown installation, unknown repo, or a non-active link all drop silently.
 */
export async function handlePullRequestWebhook(
  ctx: MutationCtx,
  args: {
    event: NormalizedPullRequestEvent;
    externalAccountId: string;
    externalRepoId: string;
    repoFullName?: string;
  },
): Promise<void> {
  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_externalAccount", (q) =>
      q.eq("externalAccountId", args.externalAccountId),
    )
    .unique();
  if (!integration) return; // unknown installation — drop silently

  const link = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_externalRepo", (q) =>
      q.eq("externalRepoId", args.externalRepoId),
    )
    .unique();
  if (!link || link.workspaceId !== integration.workspaceId) return;

  if (effectiveLinkStatus(link) !== "active") return;

  // Silent rename: keep the human-readable label fresh; stable id keeps the
  // link intact.
  let resolvedLink = link;
  if (args.repoFullName && args.repoFullName !== link.externalRepoFullName) {
    await ctx.db.patch(link._id, {
      externalRepoFullName: args.repoFullName,
    });
    resolvedLink = { ...link, externalRepoFullName: args.repoFullName };
  }

  await applyPullRequestEvent(ctx, { event: args.event, link: resolvedLink });
}

/**
 * Registered Convex surface invoked by the receiver action after it has
 * resolved closing refs via GraphQL and normalized the payload.
 */
export const handlePullRequestWebhookMutation = internalMutation({
  args: {
    event: v.any(),
    externalAccountId: v.string(),
    externalRepoId: v.string(),
    repoFullName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await handlePullRequestWebhook(ctx, {
      event: args.event as NormalizedPullRequestEvent,
      externalAccountId: args.externalAccountId,
      externalRepoId: args.externalRepoId,
      repoFullName: args.repoFullName,
    });
    return null;
  },
});
