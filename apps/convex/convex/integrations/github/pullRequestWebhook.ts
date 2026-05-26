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
  body?: string | null;
  html_url: string;
  draft: boolean;
  merged?: boolean;
  merged_at?: string | null;
  updated_at: string;
  head: { ref: string };
  base: { ref: string };
  user: GithubPrUser;
}

/**
 * GitHub's issue-closing keywords. Matched against the PR title + body so we
 * link a PR to its task regardless of base branch — GitHub's own closing graph
 * (`closingIssuesReferences`) only resolves when the PR targets the repo's
 * default branch, which would silently break branch→status automation for
 * every non-default target (e.g. `develop`).
 */
const CLOSING_KEYWORD_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+#(\d+)/gi;

/**
 * Parse same-repo closing references (`closes #27`, `fixes: #4`, …) out of PR
 * text into issue numbers. Deduped; cross-repo (`owner/repo#N`) and URL forms
 * are intentionally out of scope (the common case is same-repo `#N`).
 */
export function parseClosingIssueNumbers(text: string | null | undefined): number[] {
  if (!text) return [];
  const found = new Set<number>();
  for (const m of text.matchAll(CLOSING_KEYWORD_RE)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) found.add(n);
  }
  return [...found];
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
    closesIssueNumbers: parseClosingIssueNumbers(
      `${pr.title}\n${pr.body ?? ""}`,
    ),
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
