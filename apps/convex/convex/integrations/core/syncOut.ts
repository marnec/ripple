import type { Doc } from "../../_generated/dataModel";
import { effectiveLinkStatus } from "./entitlements";

/**
 * Pure helpers consumed by the provider-side action wrapper
 * (`github/syncOutAction`, which is run via `@convex-dev/action-retrier`).
 *
 * The retrier owns the retry loop / scheduling / exponential backoff. This
 * module owns the classification + skip-guard + desired-state logic so the
 * action body stays a thin orchestrator.
 */

/** Shape of an outbound HTTP response, normalized across providers. */
export interface OutboundResponse {
  /** HTTP status code. `null` for network errors / no response. */
  status: number | null;
  /** Parsed `Retry-After` header in ms, when present on a 429. */
  retryAfterMs?: number;
  /** Short error message captured for `lastSyncError`. */
  errorMessage?: string;
}

export type OutboundDecision = "success" | "permanent_fail" | "retry";

/**
 * Classify a response into the three outcomes that drive the action body:
 *  - "success"        — return cleanly; retrier stops.
 *  - "permanent_fail" — record `lastSyncError`, return cleanly; retrier stops.
 *  - "retry"          — throw; retrier backs off and retries.
 */
export function classifyResponse(response: OutboundResponse): OutboundDecision {
  const { status } = response;
  // Network error / no response — transient by definition, retry.
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "success";
  if (status === 429) return "retry";
  if (status >= 500) return "retry";
  return "permanent_fail";
}

/**
 * Echo guard. True when the desired external state already matches the
 * last-known one, meaning a push would produce no GitHub-side change.
 * `observed === undefined` means "never synced" — always push.
 */
export function shouldSkipForEcho(args: {
  desired: "open" | "closed";
  observed: "open" | "closed" | undefined;
}): boolean {
  return args.desired === args.observed;
}

/**
 * Freeze guard. True when the link is in any non-active effective status
 * (paused, frozen-by-billing, configuring, or disconnected). Reuses
 * `effectiveLinkStatus` so the active-vs-not-active matrix has one home.
 */
export function shouldSkipForFreeze(
  link: Pick<Doc<"projectIntegrationLinks">, "status" | "pausedByBilling">,
): boolean {
  return effectiveLinkStatus(link) !== "active";
}

/**
 * Derive what the GitHub-side state should be from Ripple state. `state` is
 * driven by the denormalized `tasks.completed` flag; `stateReason` is read
 * from the destination status's `externalCloseReason` (defaults to
 * "completed" on close, undefined on open).
 */
export function deriveDesiredExternalState(args: {
  task: Pick<Doc<"tasks">, "completed">;
  status: Pick<Doc<"taskStatuses">, "externalCloseReason">;
}): { state: "open" | "closed"; stateReason?: "completed" | "not_planned" } {
  const { task, status } = args;
  if (task.completed) {
    return { state: "closed", stateReason: status.externalCloseReason ?? "completed" };
  }
  return { state: "open" };
}

