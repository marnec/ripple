import { v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import { resolveActiveInboundLink } from "../core/inboundRouting";
import { applyPullRequestEvent } from "../core/syncInPullRequests";
import type { NormalizedPullRequestEvent } from "../core/types";
import { withTriggers } from "../../dbTriggers";

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
  merged?: boolean;
  merged_at?: string | null;
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
 * Actions we reconcile into a full-state event. `synchronize` (a push to the
 * PR branch) is intentionally excluded — it fires frequently and carries no
 * state change we track, so acting on it would burn GraphQL quota for nothing.
 */
const HANDLED_ACTIONS = new Set([
  "opened",
  "edited",
  "closed",
  "reopened",
  "ready_for_review",
  "converted_to_draft",
]);

/**
 * Whether a `pull_request` action warrants a (GraphQL-incurring) reconcile.
 * Lets the receiver skip the closing-ref lookup for ignored actions like
 * `synchronize` before any network call.
 */
export function isHandledPullRequestAction(action: string): boolean {
  return HANDLED_ACTIONS.has(action);
}

/**
 * Translate a raw `pull_request` payload + adapter-resolved closing issue
 * node ids into a normalized full-state event. Returns `null` for events or
 * actions we don't act on (e.g. `synchronize`).
 */
export function normalizePullRequestPayload(
  eventName: string,
  payload: unknown,
  closesExternalIssueIds: string[],
): NormalizedPullRequestEvent | null {
  if (eventName !== "pull_request") return null;
  const p = payload as GithubPullRequestPayload;
  if (!HANDLED_ACTIONS.has(p.action)) return null;

  const pr = p.pull_request;

  // Derive the canonical state from the payload, not the action: a close is
  // either a merge or an abandon; everything else is draft-or-open.
  let state: NormalizedPullRequestEvent["state"];
  let mergedAt: number | undefined;
  if (p.action === "closed") {
    if (pr.merged) {
      state = "merged";
      mergedAt = pr.merged_at ? Date.parse(pr.merged_at) : undefined;
    } else {
      state = "closed";
    }
  } else {
    state = pr.draft ? "draft" : "open";
  }

  return {
    kind: "pullRequest.changed",
    externalPrId: pr.node_id,
    number: pr.number,
    externalUpdatedAt: Date.parse(pr.updated_at),
    title: pr.title,
    url: pr.html_url,
    state,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    externalAuthor: {
      login: pr.user.login,
      avatarUrl: pr.user.avatar_url,
      url: pr.user.html_url,
    },
    mergedAt,
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
  const link = await resolveActiveInboundLink(ctx, {
    externalAccountId: args.externalAccountId,
    externalRepoId: args.externalRepoId,
    repoFullName: args.repoFullName,
  });
  if (!link) return; // unknown installation/repo, mismatch, or frozen — drop

  await applyPullRequestEvent(ctx, { event: args.event, link });
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
    await handlePullRequestWebhook(withTriggers(ctx), {
      event: args.event as NormalizedPullRequestEvent,
      externalAccountId: args.externalAccountId,
      externalRepoId: args.externalRepoId,
      repoFullName: args.repoFullName,
    });
    return null;
  },
});
