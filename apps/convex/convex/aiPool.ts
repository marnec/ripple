/**
 * The lane for model calls made on the app's behalf — today the workspace
 * assistant's chat replies (`chatAssistantAction.reply`).
 *
 * Its own pool rather than a share of a sibling: a model call holds a slot for
 * seconds, not milliseconds, and a provider slowdown would otherwise sit in
 * the same parallelism budget as push delivery or reassignment drains. The
 * two failure domains stay apart, as `emailPool` does for mail.
 *
 * Parallelism is deliberately low. Every job here is a paid request against
 * one provider account, so the pool doubles as the ceiling on how many are in
 * flight at once; the per-workspace ceiling on how many are *asked* is the
 * `assistantReply` rate limit.
 *
 * Retries cover the transient side of a model call — a 429, a 5xx, a dropped
 * connection. A missing API key is not transient and throws
 * `NonRetryableError` so the pool gives up on the first attempt.
 */

import { Workpool } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { BackgroundJob } from "./backgroundJobFailures";
import type {
  FunctionReference,
  OptionalRestArgs,
  SchedulableFunctionReference,
} from "convex/server";

const pool = new Workpool(components.aiPool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  // Three attempts over ~6s of backoff: enough to ride out a rate-limit blip,
  // short enough that a reply which is not coming stops occupying a slot.
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2_000, base: 2 },
});

/**
 * What a pool tells about a job's terminal outcome: the same shape
 * `backgroundJobFailures.recordTerminalFailure` takes, so a caller that needs
 * to hear the outcome itself supplies a mutation with those args and forwards
 * the failure on (`chatAssistant.replyFinished`).
 */
export type ModelCallOnComplete = typeof internal.backgroundJobFailures.recordTerminalFailure;

/**
 * Enqueue one model call. When every attempt fails the give-up is recorded in
 * `backgroundJobFailures` under `job`, where `admin/jobs` lists it — by the
 * default `onComplete`, or by whatever the caller's own one does with it.
 */
export async function scheduleModelCall<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  job: BackgroundJob & { onComplete?: ModelCallOnComplete },
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  const { onComplete, ...context } = job;
  await pool.enqueueAction(ctx, fn, ...(args as [any]), {
    onComplete: onComplete ?? internal.backgroundJobFailures.recordTerminalFailure,
    context,
  });
}
