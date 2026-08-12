/**
 * The retry machinery for the notification-subscription fanouts.
 *
 * These three drains (`publicChannelCreated`, `channelMadePublic`,
 * `channelMadePrivate`) used to be scheduled straight from `dbTriggers.ts` with
 * `ctx.scheduler.runAfter(0, …)`. A scheduled *action* is at-most-once: Convex
 * retries a scheduled mutation for you, but an action that throws is simply
 * gone, and its failure shows up nowhere a human looks. A single failed page
 * therefore left a channel permanently half-subscribed — silently.
 *
 * A separate instance rather than a share of `notificationPool`, for the reason
 * `emailPool` is separate too: `notificationPool` is the at-most-once push lane
 * (see `scheduleNotification`), and a drain that retries with backoff must not
 * occupy the parallelism slots push delivery needs — nor blur the one rule that
 * makes that pool safe, which is that nothing in it is ever retried.
 */

import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { BackgroundJob } from "./backgroundJobFailures";
import type {
  FunctionReference,
  SchedulableFunctionReference,
  OptionalRestArgs,
} from "convex/server";

const pool = new Workpool(components.subscriptionPool, {
  // One drain per channel-visibility change — bursty at workspace import time,
  // idle otherwise. Four in flight is enough to keep a burst moving without
  // putting four unbounded member scans against the database at once.
  maxParallelism: 4,
  retryActionsByDefault: true,
  // Roughly 8s of total backoff. These fail on transaction caps and OCC
  // conflicts, which clear in milliseconds; the attempts exist to ride out a
  // contended write, not an outage.
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 500, base: 2 },
});

/**
 * Enqueue one subscription drain.
 *
 * **Restart safety.** A retried attempt restarts the drain from `cursor: null`
 * rather than resuming where it failed, so every page can run more than once.
 * That is safe because these pages *converge* instead of accumulating:
 * `insertSubscription` and `deleteSubscription` both read before they write, so
 * a replayed page is a no-op rather than a duplicate. Do not copy this enqueue
 * onto a drain whose pages accumulate (append, increment, or send) without
 * giving it a cursor of its own.
 */
export async function scheduleSubscriptionDrain<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  job: BackgroundJob,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  await pool.enqueueAction(ctx, fn, ...(args as [any]), {
    onComplete: internal.backgroundJobFailures.recordTerminalFailure,
    context: job,
  });
}
