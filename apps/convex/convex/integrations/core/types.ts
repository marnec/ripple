/**
 * Provider-neutral event shape consumed by `core/syncIn.applyNormalizedEvent`.
 * Each provider adapter (currently `github/webhook`, future `gitlab/webhook`)
 * is responsible for translating raw webhook payloads into this shape.
 *
 * Phases 1–2 model `issue.opened`, `issue.closed`, `issue.reopened`.
 * Later phases add `issue.edited`, `issue_comment.*`, `pull_request.*`
 * variants as additional branches.
 */
export type NormalizedIssueEvent =
  | NormalizedIssueOpenedEvent
  | NormalizedIssueClosedEvent
  | NormalizedIssueReopenedEvent
  | NormalizedIssueDeletedEvent
  | NormalizedIssueLabelsChangedEvent
  | NormalizedIssueAssigneesChangedEvent
  | NormalizedCommentCreatedEvent
  | NormalizedCommentEditedEvent
  | NormalizedCommentDeletedEvent;

/**
 * Installation-lifecycle events — distinct from `NormalizedIssueEvent`
 * because they operate at the workspace/installation level rather than
 * per-task. Consumed by `core/syncIn.applyInstallationEvent`.
 */
export type NormalizedInstallationEvent =
  | NormalizedInstallationDeletedEvent
  | NormalizedRepositoriesRemovedEvent;

export interface NormalizedInstallationDeletedEvent {
  kind: "installation.deleted";
  /** Provider-side account/install id — used to find all
   *  `workspaceIntegrations` / `projectIntegrationLinks` to disconnect. */
  externalAccountId: string;
}

export interface NormalizedRepositoriesRemovedEvent {
  kind: "installation_repositories.removed";
  externalAccountId: string;
  /** Stable repo ids whose links should be disconnected. */
  externalRepoIds: string[];
}

/**
 * Pull/merge request events. Distinct from `NormalizedIssueEvent` because a
 * PR is an attachment on existing task(s), not a task itself. Consumed by
 * `core/syncInPullRequests.applyPullRequestEvent`.
 */
export type NormalizedPullRequestEvent = NormalizedPullRequestChangedEvent;

/**
 * A PR/MR's current observed state. Every PR webhook the adapter acts on
 * (opened, edited, closed, reopened, draft toggles) maps to this single
 * full-state event — like `issue.labels_changed`/`issue.assignees_changed`,
 * it carries the COMPLETE current state (and full closing-reference set)
 * rather than a delta, so the core reconciler stays idempotent against
 * missed or out-of-order deliveries. The adapter resolves the host's native
 * closing references via GraphQL into `closesExternalIssueIds`, keeping core
 * provider-neutral and network-free.
 */
export interface NormalizedPullRequestChangedEvent {
  kind: "pullRequest.changed";
  /** Stable provider-side PR id (GitHub: PR node id). */
  externalPrId: string;
  /** Human-facing PR number under the repo. */
  number: number;
  /** Provider event mtime, ms since epoch. Drives the ordering guard. */
  externalUpdatedAt: number;
  title: string;
  url: string;
  state: "draft" | "open" | "merged" | "closed";
  /** Source branch. */
  headRef: string;
  /** Target branch — drives the Phase 4 branch→status mapping. */
  baseRef: string;
  externalAuthor: NormalizedExternalAuthor;
  /** Set when `state === "merged"`. */
  mergedAt?: number;
  /**
   * Stable issue ids this PR closes (GitHub: issue node ids), resolved by the
   * adapter via the host's native closing graph. Core attaches the PR to those
   * that map to an imported task.
   *
   * NOTE: GitHub only populates its closing graph when the PR targets the
   * repo's DEFAULT branch — so for a PR merged into any other branch this is
   * empty even with "Closes #N" in the body. `closesIssueNumbers` (parsed from
   * the PR text) is the branch-independent fallback that keeps branch→status
   * automation working for non-default targets.
   */
  closesExternalIssueIds: string[];
  /**
   * Issue numbers parsed from the PR title/body closing keywords
   * (`closes/fixes/resolves #N`), independent of the base branch. Core resolves
   * these against `tasks.externalRefs` so a merge into a non-default branch
   * still links the PR.
   */
  closesIssueNumbers: number[];
}

/**
 * Discriminated union of every event kind the webhook router can emit.
 * `github/webhook.normalize` returns this; `handleGithubWebhook` switches
 * on `kind` to choose the right `core/syncIn.apply*` function.
 */
export type NormalizedWebhookEvent =
  | NormalizedIssueEvent
  | NormalizedInstallationEvent
  | NormalizedPullRequestEvent;

interface NormalizedExternalAuthor {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface NormalizedIssueOpenedEvent {
  kind: "issue.opened";
  /** Stable issue id from the provider (GitHub: node id). Survives renames. */
  externalIssueId: string;
  /** Human-facing issue number under the repo (e.g. 42 for #42). */
  issueNumber: number;
  /** Event timestamp from the provider, ms since epoch. Drives ordering guard. */
  externalUpdatedAt: number;
  title: string;
  /** Issue body as markdown. Stored as plain text in Phase 1 (Phase 6 wires BlockNote). */
  body: string;
  /** Provider-specific URL to the issue. Constructed by the adapter so
   *  `core/` doesn't need to know per-provider URL formats. */
  url: string;
  externalAuthor: NormalizedExternalAuthor;
}

export interface NormalizedIssueClosedEvent {
  kind: "issue.closed";
  externalIssueId: string;
  issueNumber: number;
  externalUpdatedAt: number;
  /** Full issue fields, carried so an orphan close (no prior open seen) can
   *  upsert a task with the right metadata. */
  title: string;
  body: string;
  url: string;
  externalAuthor: NormalizedExternalAuthor;
  /** Provider-specific close reason. GitHub maps directly; other providers
   *  default to "completed". */
  stateReason: "completed" | "not_planned";
  /** GitHub user who flipped the issue to closed, when present in the
   *  payload. Renders as "Closed on GitHub by @\<login\>" on task detail
   *  when this user is not a workspace member. Optional because import
   *  jobs and some webhook variants don't carry it. */
  closedBy?: NormalizedExternalAuthor;
}

export interface NormalizedIssueReopenedEvent {
  kind: "issue.reopened";
  externalIssueId: string;
  issueNumber: number;
  externalUpdatedAt: number;
  title: string;
  body: string;
  url: string;
  externalAuthor: NormalizedExternalAuthor;
}

/**
 * Issue permanently deleted on the provider side (GitHub `issues.deleted`).
 * Terminal: the external issue no longer exists, so there is nothing to
 * reconcile beyond marking the link orphaned. Carries no full-issue payload
 * (no orphan-task synthesis from a delete) — only enough to locate the link
 * and order the write. The Ripple task is kept; the link is flagged.
 */
export interface NormalizedIssueDeletedEvent {
  kind: "issue.deleted";
  externalIssueId: string;
  issueNumber: number;
  externalUpdatedAt: number;
}

/**
 * Emitted by the provider adapter for both `issues.labeled` and
 * `issues.unlabeled` events. Carries the **full** new label set rather than
 * a delta so the core reconciler can call `syncTaskTags` once and remain
 * idempotent against missed or out-of-order deliveries.
 *
 * Names are passed through as the provider stored them; `core/syncIn`
 * normalizes (trim/lowercase/dedupe) before writing.
 */
export interface NormalizedIssueLabelsChangedEvent {
  kind: "issue.labels_changed";
  externalIssueId: string;
  issueNumber: number;
  externalUpdatedAt: number;
  labels: string[];
}

/**
 * Emitted by the provider adapter for both `issues.assigned` and
 * `issues.unassigned` events. Carries the **full** new assignee set rather
 * than a delta so the core reconciler can pick a single Ripple `assigneeId`
 * + a shadow-chip set in one pass and remain idempotent under retries.
 */
export interface NormalizedIssueAssigneesChangedEvent {
  kind: "issue.assignees_changed";
  externalIssueId: string;
  issueNumber: number;
  externalUpdatedAt: number;
  assignees: {
    login: string;
    avatarUrl: string;
    url: string;
  }[];
}

/**
 * Comment created on the external side. The adapter resolves the parent
 * issue's stable id (`externalIssueId`) so `core/syncIn` can find the
 * `taskIntegrationLinks` row to attach the comment to. Comments on issues
 * Ripple never imported are dropped — no orphan task synthesis.
 */
export interface NormalizedCommentCreatedEvent {
  kind: "comment.created";
  /** Stable provider-side comment id. GitHub: comment node id. */
  externalCommentId: string;
  externalIssueId: string;
  externalUpdatedAt: number;
  body: string;
  externalAuthor: NormalizedExternalAuthor;
}

/**
 * Comment edited on the external side. Carries the full new body — the
 * core reconciler treats every edit as a replace, not a delta. The
 * `externalIssueId` is informational (the comment row already knows its
 * parent); kept on the event so adapters can construct it from any
 * payload shape without a pre-lookup.
 */
export interface NormalizedCommentEditedEvent {
  kind: "comment.edited";
  externalCommentId: string;
  externalIssueId: string;
  externalUpdatedAt: number;
  body: string;
}

/**
 * Comment deleted on the external side. The receiver soft-deletes the
 * Ripple comment row; the link row stays so a redelivery is a no-op via
 * the externalUpdatedAt guard.
 */
export interface NormalizedCommentDeletedEvent {
  kind: "comment.deleted";
  externalCommentId: string;
  externalIssueId: string;
  externalUpdatedAt: number;
}
