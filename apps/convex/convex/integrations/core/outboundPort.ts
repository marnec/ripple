/**
 * The driven port for outbound integration sync (Ripple → external provider).
 *
 * This module is intentionally free of Convex runtime imports (`_generated`,
 * `convex/server`) so the orchestrator and its tests can consume it without a
 * Convex action context. The GitHub adapter (`github/outboundGateway.ts`)
 * implements `OutboundGateway`; a future GitLab adapter would implement the
 * same port and the orchestrator would not change.
 *
 * Each gateway method performs 1+ HTTP requests and folds the result(s) into a
 * single `OutboundOutcome`. All GitHub-specific HTTP semantics — response
 * classification, multi-request fan-out (labels = POST adds + DELETE removes),
 * the 404-on-DELETE-is-benign rule, and the 429 `Retry-After` pre-sleep — live
 * behind this boundary, invisible to the orchestrator.
 */

/**
 * Metadata the success path needs to persist. Recording the provider's own
 * `updated_at` (not wall-clock) is load-bearing: it makes the bounce-back
 * webhook for this same change compare EQUAL under the inbound `isStale`
 * guard and drop, while a genuine later edit carries a strictly-greater
 * timestamp and applies. Set-mirrored fields (labels/assignees) deliberately
 * leave `externalUpdatedAt` undefined — their echo guard is set-comparison,
 * timestamp-independent.
 */
export interface OutboundSuccessMeta {
  /** Provider's authoritative `updated_at`, parsed to ms. */
  externalUpdatedAt?: number;
  /** comment-create only: the numeric REST id the provider assigned, as a string. */
  externalCommentId?: string;
  /** comment-create / issue-create: the resolved author chip (the App bot). */
  externalAuthor?: { login: string; avatarUrl: string; url: string };
  /** issue-create only: the issue's stable GraphQL node id (matches the
   *  inbound `externalIssueId`, so the bounce-back `issues.opened` webhook
   *  dedups against the link this op writes). */
  externalIssueId?: string;
  /** issue-create only: the human issue number GitHub assigned (REST needs it
   *  for every later push; mirrored onto `tasks.externalRefs`). */
  issueNumber?: number;
}

/**
 * The three outcomes that drive the orchestrator:
 *  - "success"        — record the mirror, stop.
 *  - "permanent_fail" — record `lastSyncError`, stop.
 *  - "retryable"      — throw so the action-retrier backs off and retries.
 *
 * The adapter has already honored `Retry-After` (pre-sleep) before returning
 * "retryable", so the orchestrator can throw immediately without sleeping —
 * which keeps it pure and synchronously testable.
 */
export type OutboundOutcome =
  | { kind: "success"; meta: OutboundSuccessMeta }
  | { kind: "permanent_fail"; message: string; httpStatus?: number }
  | { kind: "retryable"; message: string };

export interface OutboundGateway {
  /** Creates a new issue (task → GitHub). Success meta carries the node id,
   *  number, author and `updated_at` needed to write the task↔issue link. */
  createIssue(a: {
    repoFullName: string;
    title: string;
    body: string;
  }): Promise<OutboundOutcome>;

  setIssueState(a: {
    repoFullName: string;
    issueNumber: number;
    state: "open" | "closed";
    stateReason?: "completed" | "not_planned";
  }): Promise<OutboundOutcome>;

  setDescription(a: {
    repoFullName: string;
    issueNumber: number;
    markdown: string;
  }): Promise<OutboundOutcome>;

  /** POSTs `add` labels then DELETEs `remove` labels; 404-on-DELETE is benign. */
  setLabels(a: {
    repoFullName: string;
    issueNumber: number;
    add: string[];
    remove: string[];
  }): Promise<OutboundOutcome>;

  setAssignees(a: {
    repoFullName: string;
    issueNumber: number;
    add: string[];
    remove: string[];
  }): Promise<OutboundOutcome>;

  createComment(a: {
    repoFullName: string;
    issueNumber: number;
    body: string;
  }): Promise<OutboundOutcome>;

  editComment(a: {
    repoFullName: string;
    externalCommentId: string;
    body: string;
  }): Promise<OutboundOutcome>;

  /** DELETEs the comment; a 404 is treated as success (already gone). */
  deleteComment(a: {
    repoFullName: string;
    externalCommentId: string;
  }): Promise<OutboundOutcome>;
}
