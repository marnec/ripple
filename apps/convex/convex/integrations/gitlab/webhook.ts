/**
 * GitLab webhook adapter — the provider-specific verify + normalize layer that
 * mirrors `github/webhook.ts`. It translates raw GitLab webhook payloads into
 * the provider-neutral `Normalized*` shapes that `core/syncIn` and
 * `core/syncInPullRequests` already consume, so the entire reconciliation
 * suite (forward-only / most-advanced-wins / echo guards) carries over
 * unchanged.
 *
 * Differences from GitHub baked in here (and only here):
 *  - verification is a plaintext `X-Gitlab-Token` equality check against a
 *    per-hook secret, not an `X-Hub-Signature-256` HMAC;
 *  - the stable external id is GitLab's global `object_attributes.id` (the
 *    project-scoped `iid` is the human-facing number);
 *  - there are no node ids / GraphQL closing graph, so MR events leave
 *    `closesExternalIssueIds` empty and rely on the parsed `closesIssueNumbers`.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { withTriggers } from "../../dbTriggers";
import { effectiveLinkStatus } from "../core/entitlements";
import { applyNormalizedEvent } from "../core/syncIn";
import { applyPullRequestEvent } from "../core/syncInPullRequests";
import type {
  NormalizedIssueEvent,
  NormalizedPullRequestEvent,
} from "../core/types";
import { collectReferencedIssueNumbers } from "../core/closingRefs";
import { GITLAB_BASE } from "./oauthClient";

interface GitlabUser {
  id: number;
  username: string;
  // Issue/Note hook payloads only carry `id`, `name`, `username`, `avatar_url`,
  // `email` on the user object — `web_url` is ONLY present on certain payloads
  // (e.g. merge request hooks). Treat both as optional so the normalizer can
  // synthesize fallbacks when the provider omits them.
  avatar_url?: string;
  web_url?: string;
}

interface GitlabIssueAttributes {
  id: number;
  iid: number;
  title: string;
  description?: string | null;
  state: string;
  action: string;
  url: string;
  updated_at: string;
}

interface GitlabIssuePayload {
  object_kind: "issue";
  user: GitlabUser;
  object_attributes: GitlabIssueAttributes;
  // Present on `action: "update"` — keyed by the attributes that changed.
  changes?: Record<string, unknown>;
  // Full current label / assignee sets (GitLab sends the whole set, not a delta).
  labels?: { title: string }[];
  assignees?: GitlabUser[];
}

/**
 * Parse a GitLab webhook timestamp to ms since epoch. GitLab historically
 * emits `"YYYY-MM-DD HH:MM:SS UTC"`; newer payloads use ISO-8601. Normalize the
 * legacy form to ISO so `Date.parse` is reliable across engines.
 */
function parseGitlabTime(s: string): number {
  const iso = s.includes("T") ? s : s.replace(" UTC", "Z").replace(" ", "T");
  return Date.parse(iso);
}

function gitlabAuthor(user: GitlabUser) {
  // Synthesize a profile URL when the payload omits `web_url` (Issue/Note
  // hooks do). `taskIntegrationLinks.externalAuthor` requires a string url,
  // and the canonical `<base>/<username>` form is what GitLab itself serves
  // for a profile page anyway.
  return {
    login: user.username,
    avatarUrl: user.avatar_url ?? "",
    url: user.web_url ?? `${GITLAB_BASE}/${user.username}`,
  };
}

/**
 * Translate a raw GitLab webhook payload into a provider-neutral
 * `NormalizedIssueEvent`, or null for deliveries we don't act on. Dispatches on
 * `object_kind` (carried in the body), mirroring `github/webhook.normalize`.
 */
export function normalize(payload: unknown): NormalizedIssueEvent | null {
  const kind = (payload as { object_kind?: string } | null)?.object_kind;
  if (kind === "issue") return normalizeIssueEvent(payload as GitlabIssuePayload);
  if (kind === "note") return normalizeNoteEvent(payload as GitlabNotePayload);
  return null;
}

interface GitlabNotePayload {
  object_kind: "note";
  user: GitlabUser;
  object_attributes: {
    id: number;
    note: string;
    noteable_type: string;
    updated_at: string;
    url: string;
  };
  issue?: { id: number; iid: number };
}

/**
 * GitLab note hooks fire on comment creation. We only thread Issue notes —
 * MergeRequest / Commit / Snippet notes are dropped (PRs are attachments, not
 * comment threads, mirroring GitHub's `issue_comment` PR-link drop). The
 * comment keys off the issue's global id so it joins the same task the issue
 * events created.
 */
function normalizeNoteEvent(
  p: GitlabNotePayload,
): NormalizedIssueEvent | null {
  const a = p.object_attributes;
  if (a.noteable_type !== "Issue" || !p.issue) return null;
  return {
    kind: "comment.created",
    externalCommentId: String(a.id),
    externalIssueId: String(p.issue.id),
    externalUpdatedAt: parseGitlabTime(a.updated_at),
    body: a.note,
    externalAuthor: gitlabAuthor(p.user),
  };
}

/**
 * GitLab issue lifecycle. `action` ∈ {open, close, reopen, update}; the
 * state-bearing ones map to the existing issue events. `update` (label /
 * assignee / edit) is handled in a later slice.
 */
function normalizeIssueEvent(
  p: GitlabIssuePayload,
): NormalizedIssueEvent | null {
  const a = p.object_attributes;
  const shared = {
    externalIssueId: String(a.id),
    issueNumber: a.iid,
    externalUpdatedAt: parseGitlabTime(a.updated_at),
    title: a.title,
    body: a.description ?? "",
    url: a.url,
    externalAuthor: gitlabAuthor(p.user),
  };

  if (a.action === "open") return { kind: "issue.opened", ...shared };
  if (a.action === "reopen") return { kind: "issue.reopened", ...shared };
  if (a.action === "close") {
    // GitLab has no completed/not_planned distinction — default to completed.
    return { kind: "issue.closed", ...shared, stateReason: "completed" };
  }
  if (a.action === "update") return normalizeIssueUpdate(p);
  return null;
}

/**
 * GitLab bundles every issue mutation into a single `update` action whose
 * `changes` map names what moved (vs GitHub's discrete labeled/assigned
 * events). Map a label change → `issue.labels_changed` and an assignee change →
 * `issue.assignees_changed`, both carrying the full current set (the events are
 * full-state, so the reconciler stays idempotent). Labels take priority if both
 * moved in one update; a later full-state event corrects the other facet.
 * Plain title/description edits have no normalized event → null.
 */
function normalizeIssueUpdate(
  p: GitlabIssuePayload,
): NormalizedIssueEvent | null {
  const a = p.object_attributes;
  const base = {
    externalIssueId: String(a.id),
    issueNumber: a.iid,
    externalUpdatedAt: parseGitlabTime(a.updated_at),
  };
  const changed = p.changes ?? {};
  if ("labels" in changed) {
    return {
      kind: "issue.labels_changed",
      ...base,
      labels: (p.labels ?? []).map((l) => l.title),
    };
  }
  if ("assignees" in changed) {
    return {
      kind: "issue.assignees_changed",
      ...base,
      // Carry the numeric user id alongside the display fields: GitLab addresses
      // members by id, so the core reconciler resolves the Ripple assignee from
      // `id` (not `login`) via `users.gitlabUserId` / the override table.
      assignees: (p.assignees ?? []).map((u) => ({
        ...gitlabAuthor(u),
        id: String(u.id),
      })),
    };
  }
  return null;
}

interface GitlabMergeRequestPayload {
  object_kind: "merge_request";
  user: GitlabUser;
  object_attributes: {
    id: number;
    iid: number;
    title: string;
    description?: string | null;
    state: string;
    action: string;
    source_branch: string;
    target_branch: string;
    url: string;
    updated_at: string;
    draft?: boolean;
    work_in_progress?: boolean;
  };
}

// MR actions that carry a state we reconcile. Approvals and other
// discussion-only actions are dropped (no state change to track).
const HANDLED_MR_ACTIONS = new Set([
  "open",
  "reopen",
  "close",
  "merge",
  "update",
]);

/**
 * Translate a GitLab `merge_request` payload into the provider-neutral
 * full-state `NormalizedPullRequestEvent`. Kept separate from `normalize`
 * (different event type), mirroring GitHub's `normalizePullRequestPayload`.
 *
 * Unlike GitHub there's no GraphQL closing graph, so `closesExternalIssueIds`
 * is always empty and linking rides entirely on `closesIssueNumbers`, parsed
 * from the title/body + source branch via the shared `core/closingRefs` helper
 * (seam 5). Returns null for non-MR payloads and discussion-only actions.
 */
export function normalizeMergeRequest(
  payload: unknown,
): NormalizedPullRequestEvent | null {
  const kind = (payload as { object_kind?: string } | null)?.object_kind;
  if (kind !== "merge_request") return null;
  const p = payload as GitlabMergeRequestPayload;
  const a = p.object_attributes;
  if (!HANDLED_MR_ACTIONS.has(a.action)) return null;

  const externalUpdatedAt = parseGitlabTime(a.updated_at);
  const state = mergeRequestState(a);

  return {
    kind: "pullRequest.changed",
    externalPrId: String(a.id),
    number: a.iid,
    externalUpdatedAt,
    title: a.title,
    url: a.url,
    state,
    headRef: a.source_branch,
    baseRef: a.target_branch,
    externalAuthor: gitlabAuthor(p.user),
    ...(state === "merged" ? { mergedAt: externalUpdatedAt } : {}),
    closesExternalIssueIds: [],
    closesIssueNumbers: collectReferencedIssueNumbers(
      `${a.title}\n${a.description ?? ""}`,
      a.source_branch,
    ),
  };
}

/**
 * Derive the canonical PR state from a GitLab MR's `state` (+ draft flag).
 * `locked` is an open MR with discussion locked — not a terminal state — so it
 * maps to `open`.
 */
function mergeRequestState(
  a: GitlabMergeRequestPayload["object_attributes"],
): NormalizedPullRequestEvent["state"] {
  if (a.state === "merged") return "merged";
  if (a.state === "closed") return "closed";
  return a.draft || a.work_in_progress ? "draft" : "open";
}

/**
 * Verify a GitLab delivery by constant-time equality of its `X-Gitlab-Token`
 * header against the per-hook secret. Returns false when either side is
 * missing/empty so an unconfigured secret never accepts a delivery.
 */
export function verifyGitlabToken(
  received: string | null | undefined,
  expected: string,
): boolean {
  if (!received || !expected) return false;
  if (received.length !== expected.length) return false;
  // Constant-time compare over equal-length strings: never early-exit on the
  // first differing char.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Resolve the live, sync-active project link a GitLab delivery targets, or
 * `null` to drop it. GitLab's auth model is per-link, not central: there's no
 * App installation, so we resolve the link by the payload's project id
 * (`externalRepoId`) and then verify the delivery's `X-Gitlab-Token` against
 * THAT link's stored `webhookSecret` — inverting GitHub's verify-then-resolve
 * order. A missing/mismatched token, an unknown/disconnected project, or a
 * frozen/paused link all return `null`.
 */
export async function resolveGitlabInboundLink(
  ctx: MutationCtx,
  args: { externalRepoId: string; token: string | null | undefined },
): Promise<Doc<"projectIntegrationLinks"> | null> {
  const repoLinks = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_externalRepo", (q) =>
      q.eq("externalRepoId", args.externalRepoId),
    )
    .collect();
  const link = repoLinks.find((l) => l.status !== "disconnected") ?? null;
  if (!link) return null; // unknown/disconnected project — drop silently

  // Per-link secret IS the authentication (replaces GitHub's central HMAC).
  if (!verifyGitlabToken(args.token, link.webhookSecret ?? "")) return null;

  // Freeze gate.
  if (effectiveLinkStatus(link) !== "active") return null;

  await ctx.db.patch(link._id, { lastWebhookAt: Date.now() });
  return link;
}

/**
 * Apply a verified GitLab delivery to Ripple state. Routes on `object_kind`:
 * `merge_request` → the PR reconciler; `issue`/`note` → the issue reconciler.
 * Resolves + verifies the link per delivery (the per-link token is the auth).
 * Drops cleanly (no throw) for every irrelevant/unauthenticated case so the
 * receiver doesn't retry/DLQ.
 */
export async function handleGitlabWebhook(
  ctx: MutationCtx,
  args: { payload: unknown; token: string | null | undefined },
): Promise<void> {
  const { payload, token } = args;
  const externalRepoId = String(
    (payload as { project?: { id?: number | string } } | null)?.project?.id ??
      "",
  );
  if (!externalRepoId) return;
  const kind = (payload as { object_kind?: string } | null)?.object_kind;

  if (kind === "merge_request") {
    const event = normalizeMergeRequest(payload);
    if (!event) return; // discussion-only action — drop
    const link = await resolveGitlabInboundLink(ctx, {
      externalRepoId,
      token,
    });
    if (!link) return;
    await applyPullRequestEvent(ctx, { event, link });
    return;
  }

  const event = normalize(payload);
  if (!event) return; // irrelevant issue/note action — drop
  const link = await resolveGitlabInboundLink(ctx, { externalRepoId, token });
  if (!link) return;
  // Per-link opt-out: stop auto-pulling issue/comment changes (PR sync stays on).
  if (link.inboundIssueSyncDisabled) return;
  await applyNormalizedEvent(ctx, { event, link });
}

/**
 * Registered Convex surface for the GitLab webhook handler. Unit tests target
 * the plain `handleGitlabWebhook` helper above; the receiver bridge calls this
 * internal mutation by reference.
 */
export const handleGitlabWebhookMutation = internalMutation({
  args: { payload: v.any(), token: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await handleGitlabWebhook(withTriggers(ctx), {
      payload: args.payload,
      token: args.token,
    });
    return null;
  },
});

/**
 * Bridge action invoked by `@convex-webhook-receiver` per delivery. GitLab
 * verification can't happen here (the secret is per-link, resolved in the
 * mutation), so this just parses the body + threads the `X-Gitlab-Token`
 * header through. The receiver has already deduped by `X-Gitlab-Event-UUID`.
 */
export const receiveGitlabWebhook = internalAction({
  args: {
    provider: v.string(),
    rawBody: v.string(),
    headers: v.record(v.string(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventName = args.headers["x-gitlab-event"];
    if (!eventName) return null; // not a GitLab delivery — drop
    const token = args.headers["x-gitlab-token"];
    const payload = JSON.parse(args.rawBody) as unknown;
    await ctx.runMutation(
      internal.integrations.gitlab.webhook.handleGitlabWebhookMutation,
      { payload, token },
    );
    return null;
  },
});
