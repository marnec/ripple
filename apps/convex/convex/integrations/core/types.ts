/**
 * Provider-neutral event shape consumed by `core/syncIn.applyNormalizedEvent`.
 * Each provider adapter (currently `github/webhook`, future `gitlab/webhook`)
 * is responsible for translating raw webhook payloads into this shape.
 *
 * Phases 1–2 model `issue.opened`, `issue.closed`, `issue.reopened`.
 * Later phases add `issue.edited`, `issue_comment.*`, `pull_request.*`, and
 * `installation.*` variants as additional branches.
 */
export type NormalizedIssueEvent =
  | NormalizedIssueOpenedEvent
  | NormalizedIssueClosedEvent
  | NormalizedIssueReopenedEvent;

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
