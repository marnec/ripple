import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { effectiveLinkStatus } from "../core/entitlements";
import {
  applyInstallationEvent,
  applyNormalizedEvent,
} from "../core/syncIn";
import { GithubClient } from "./client";
import {
  isHandledPullRequestAction,
  normalizePullRequestPayload,
} from "./pullRequestWebhook";
import type {
  NormalizedInstallationEvent,
  NormalizedIssueEvent,
} from "../core/types";

/**
 * Provider-specific webhook parsing. Translates a GitHub webhook payload
 * (the raw JSON body, plus the value of the `X-GitHub-Event` header) into
 * a provider-neutral `NormalizedIssueEvent` that `core/syncIn` consumes.
 *
 * Returns `null` for event kinds we don't act on yet — the handler treats
 * this as "delivered but irrelevant" (no task work, no error).
 *
 * This module is the architectural contract: adding GitLab means adding a
 * sibling `gitlab/webhook.ts` with its own `normalize`; `core/` never
 * branches on provider.
 */
// GitHub's `issues` event ships an action discriminator in the payload.
// We narrow the JSON shape only as much as we need to read fields safely.
interface GithubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

interface GithubLabel {
  name: string;
}

interface GithubIssue {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | null;
  updated_at: string; // ISO 8601
  html_url: string;
  user: GithubUser;
  // Present on issues.labeled / issues.unlabeled (and on the full issue
  // object generally). Carries the current label set after the delta.
  labels?: GithubLabel[];
  // Present on issues.assigned / issues.unassigned. Carries the current
  // assignee set after the delta, in GitHub's display order.
  assignees?: GithubUser[];
  // Present on issues.closed when the close action carries a user. May
  // be null/absent on synthetic closes (e.g. PR-merge-driven closes).
  closed_by?: GithubUser | null;
}

interface GithubInstallation {
  id: number;
}

interface GithubRepository {
  node_id: string;
  full_name: string;
}

interface GithubIssuesPayload {
  action: string;
  issue: GithubIssue;
  installation?: GithubInstallation;
  repository?: GithubRepository;
}

/**
 * Handler invoked by `@convex-dev/webhook-receiver` per delivery. The
 * component has already done HMAC verification + delivery-id dedup; this
 * mutation owns the business-logic routing:
 *
 *  1. Normalize the payload.
 *  2. Resolve workspace by installation id, link by repo id.
 *  3. Freeze gate (drop if not sync-active).
 *  4. Update `externalRepoFullName` silently on rename detection.
 *  5. Dispatch to `core/syncIn.applyNormalizedEvent`.
 *
 * Returns `void` and never throws on "delivered but irrelevant" cases —
 * unknown installation, unknown repo, unsupported event — so the component
 * doesn't enter its retry/DLQ path for things that are by-design dropped.
 */
export async function handleGithubWebhook(
  ctx: MutationCtx,
  args: { eventName: string; payload: unknown },
): Promise<void> {
  const event = normalize(args.eventName, args.payload);
  if (!event) return; // delivered-but-irrelevant — drop, no error

  // Installation-lifecycle events operate at the workspace/installation
  // level and resolve their own DB lookups; no per-repo link resolution
  // needed at this layer.
  if (
    event.kind === "installation.deleted" ||
    event.kind === "installation_repositories.removed"
  ) {
    await applyInstallationEvent(ctx, { event });
    return;
  }

  const p = args.payload as GithubIssuesPayload;
  const externalAccountId = String(p.installation?.id ?? "");
  const externalRepoId = p.repository?.node_id ?? "";

  // Resolve workspace via installation id.
  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_externalAccount", (q) =>
      q.eq("externalAccountId", externalAccountId),
    )
    .unique();
  if (!integration) return; // unknown installation — drop silently

  // Resolve link via stable repo id (survives renames). A repo may have
  // several rows here — disconnected historical links coexist with the live
  // one (createLink only forbids *live* duplicates), so pick the single
  // non-disconnected link rather than assuming uniqueness.
  const repoLinks = await ctx.db
    .query("projectIntegrationLinks")
    .withIndex("by_externalRepo", (q) =>
      q.eq("externalRepoId", externalRepoId),
    )
    .collect();
  const link = repoLinks.find((l) => l.status !== "disconnected") ?? null;
  if (!link || link.workspaceId !== integration.workspaceId) return;

  // Freeze gate.
  if (effectiveLinkStatus(link) !== "active") return;

  // Record receipt for the "Last webhook received" indicator. Written only
  // for sync-active links (frozen/paused links never reach here), matching
  // the indicator's intent: "are we still receiving live events?"
  await ctx.db.patch(link._id, { lastWebhookAt: Date.now() });

  // Silent rename: if the payload's `repository.full_name` differs from
  // what's stored, patch it. The stable `externalRepoId` keeps the link
  // intact; only the human-readable label drifts.
  const incomingFullName = p.repository?.full_name;
  let resolvedLink = link;
  if (incomingFullName && incomingFullName !== link.externalRepoFullName) {
    await ctx.db.patch(link._id, { externalRepoFullName: incomingFullName });
    resolvedLink = { ...link, externalRepoFullName: incomingFullName };
  }

  await applyNormalizedEvent(ctx, { event, link: resolvedLink });
}

interface GithubInstallationPayload {
  action: string;
  installation: GithubInstallation;
  // Only present on installation_repositories.* events.
  repositories_removed?: GithubRepository[];
  repositories_added?: GithubRepository[];
}

export function normalize(
  eventName: string,
  payload: unknown,
): NormalizedIssueEvent | NormalizedInstallationEvent | null {
  if (eventName === "issues") return normalizeIssuesEvent(payload);
  if (eventName === "issue_comment") {
    return normalizeIssueCommentEvent(payload);
  }
  if (eventName === "installation") return normalizeInstallationEvent(payload);
  if (eventName === "installation_repositories") {
    return normalizeInstallationRepositoriesEvent(payload);
  }
  return null;
}

interface GithubIssueComment {
  node_id: string;
  body: string | null;
  updated_at: string;
  user: GithubUser;
}

interface GithubIssueCommentPayload {
  action: string;
  issue: { node_id: string; number: number; pull_request?: unknown };
  comment: GithubIssueComment;
}

function normalizeIssueCommentEvent(
  payload: unknown,
): NormalizedIssueEvent | null {
  const p = payload as GithubIssueCommentPayload;
  // GitHub delivers PR comments as `issue_comment` events with an
  // `issue.pull_request` link. PRs are attachments, not comment threads —
  // drop these explicitly (they'd otherwise fall through the orphan path).
  if (p.issue?.pull_request) return null;
  if (p.action === "created") {
    return {
      kind: "comment.created",
      externalCommentId: p.comment.node_id,
      externalIssueId: p.issue.node_id,
      externalUpdatedAt: Date.parse(p.comment.updated_at),
      body: p.comment.body ?? "",
      externalAuthor: {
        login: p.comment.user.login,
        avatarUrl: p.comment.user.avatar_url,
        url: p.comment.user.html_url,
      },
    };
  }
  if (p.action === "edited") {
    return {
      kind: "comment.edited",
      externalCommentId: p.comment.node_id,
      externalIssueId: p.issue.node_id,
      externalUpdatedAt: Date.parse(p.comment.updated_at),
      body: p.comment.body ?? "",
    };
  }
  if (p.action === "deleted") {
    return {
      kind: "comment.deleted",
      externalCommentId: p.comment.node_id,
      externalIssueId: p.issue.node_id,
      externalUpdatedAt: Date.parse(p.comment.updated_at),
    };
  }
  return null;
}

function normalizeIssuesEvent(payload: unknown): NormalizedIssueEvent | null {
  const p = payload as GithubIssuesPayload;

  if (p.action === "opened") {
    return {
      kind: "issue.opened",
      ...sharedIssueFields(p.issue),
    };
  }

  if (p.action === "closed") {
    const closedBy = p.issue.closed_by;
    return {
      kind: "issue.closed",
      ...sharedIssueFields(p.issue),
      stateReason: p.issue.state_reason ?? "completed",
      ...(closedBy
        ? {
            closedBy: {
              login: closedBy.login,
              avatarUrl: closedBy.avatar_url,
              url: closedBy.html_url,
            },
          }
        : {}),
    };
  }

  if (p.action === "reopened") {
    return {
      kind: "issue.reopened",
      ...sharedIssueFields(p.issue),
    };
  }

  if (p.action === "labeled" || p.action === "unlabeled") {
    return {
      kind: "issue.labels_changed",
      externalIssueId: p.issue.node_id,
      issueNumber: p.issue.number,
      externalUpdatedAt: Date.parse(p.issue.updated_at),
      labels: (p.issue.labels ?? []).map((l) => l.name),
    };
  }

  if (p.action === "assigned" || p.action === "unassigned") {
    return {
      kind: "issue.assignees_changed",
      externalIssueId: p.issue.node_id,
      issueNumber: p.issue.number,
      externalUpdatedAt: Date.parse(p.issue.updated_at),
      assignees: (p.issue.assignees ?? []).map((u) => ({
        login: u.login,
        avatarUrl: u.avatar_url,
        url: u.html_url,
      })),
    };
  }

  return null;
}

function normalizeInstallationEvent(
  payload: unknown,
): NormalizedInstallationEvent | null {
  const p = payload as GithubInstallationPayload;
  if (p.action !== "deleted") return null;
  return {
    kind: "installation.deleted",
    externalAccountId: String(p.installation.id),
  };
}

function normalizeInstallationRepositoriesEvent(
  payload: unknown,
): NormalizedInstallationEvent | null {
  const p = payload as GithubInstallationPayload;
  if (p.action !== "removed") return null;
  return {
    kind: "installation_repositories.removed",
    externalAccountId: String(p.installation.id),
    externalRepoIds: (p.repositories_removed ?? []).map((r) => r.node_id),
  };
}

/**
 * The seven fields every issue-event variant carries. Extracted because
 * GitHub's payload shape is identical across `opened`, `closed`, and
 * `reopened` — only the discriminator (and the close-only `state_reason`)
 * differ.
 */
function sharedIssueFields(issue: GithubIssue) {
  return {
    externalIssueId: issue.node_id,
    issueNumber: issue.number,
    externalUpdatedAt: Date.parse(issue.updated_at),
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url,
    externalAuthor: {
      login: issue.user.login,
      avatarUrl: issue.user.avatar_url,
      url: issue.user.html_url,
    },
  };
}

/**
 * Registered Convex surface for the webhook handler. Unit tests target the
 * plain `handleGithubWebhook` helper above; the receiver bridge calls this
 * internal mutation by reference.
 */
export const handleGithubWebhookMutation = internalMutation({
  args: { eventName: v.string(), payload: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await handleGithubWebhook(ctx, args);
    return null;
  },
});

/**
 * Bridge action invoked by `@convex-webhook-receiver` per delivery. The
 * receiver has already verified the HMAC signature and deduplicated by
 * `X-GitHub-Delivery`; our job is to parse + dispatch.
 *
 * Throwing here makes the receiver flag the delivery for retry/DLQ;
 * we throw on JSON-parse failure (genuinely malformed) but NOT on
 * "irrelevant event" cases (those return cleanly from the mutation).
 */
export const receiveGithubWebhook = internalAction({
  args: {
    provider: v.string(),
    rawBody: v.string(),
    headers: v.record(v.string(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const eventName = args.headers["x-github-event"];
    if (!eventName) {
      // Missing event-name header — drop silently. Marking as malformed
      // would consume DLQ slots on every probe ping.
      return null;
    }
    const payload = JSON.parse(args.rawBody) as unknown;

    // Pull-request deliveries need a GraphQL hop to resolve the issues the PR
    // closes (the REST payload doesn't carry them) — so they take a separate
    // path from the pure-mutation issue/comment routing.
    if (eventName === "pull_request") {
      await routePullRequestDelivery(ctx, payload);
      return null;
    }

    await ctx.runMutation(
      internal.integrations.github.webhook.handleGithubWebhookMutation,
      { eventName, payload },
    );
    return null;
  },
});

interface GithubPrDeliveryShape {
  action: string;
  pull_request?: { number: number };
  installation?: { id: number };
  repository?: {
    node_id: string;
    full_name: string;
    owner?: { login: string };
    name?: string;
  };
}

/**
 * Resolve a PR delivery's closing references via GraphQL, normalize, and
 * dispatch. Unhandled actions (e.g. `synchronize`) short-circuit before any
 * network call so we don't burn GraphQL quota on events we drop.
 */
async function routePullRequestDelivery(
  ctx: ActionCtx,
  payload: unknown,
): Promise<void> {
  const p = payload as GithubPrDeliveryShape;
  if (!isHandledPullRequestAction(p.action)) return;

  const installationId = String(p.installation?.id ?? "");
  const owner = p.repository?.owner?.login;
  const repo = p.repository?.name;
  const prNumber = p.pull_request?.number;
  if (!installationId || !owner || !repo || prNumber === undefined) return;

  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) return; // credentials missing — drop

  const client = new GithubClient({ appId, privateKeyPem });
  const token = await client.mintInstallationToken(installationId);
  const closesExternalIssueIds = await client.fetchClosingIssueNodeIds({
    installationToken: token,
    owner,
    repo,
    prNumber,
  });

  const event = normalizePullRequestPayload(
    "pull_request",
    payload,
    closesExternalIssueIds,
  );
  if (!event) return;

  await ctx.runMutation(
    internal.integrations.github.pullRequestWebhook
      .handlePullRequestWebhookMutation,
    {
      event,
      externalAccountId: installationId,
      externalRepoId: p.repository?.node_id ?? "",
      repoFullName: p.repository?.full_name,
    },
  );
}
