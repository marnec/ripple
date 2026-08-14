/**
 * The retry machinery for call-transcript ingestion.
 *
 * `ingestTranscript` used to be scheduled straight from the webhook route with
 * `ctx.scheduler.runAfter(0, …)`. A scheduled *action* is at-most-once (see the
 * header on `subscriptionPool.ts`), and this one is the worst possible place
 * for that: the route had already acked Cloudflare, so the `meeting.transcript`
 * event was retired, and its download URL is short-lived — a single throw meant
 * the call's transcript no longer existed anywhere.
 *
 * The route now captures the bytes before it acks, which is what makes an
 * attempt repeatable; this pool is what repeats it, and its `onComplete` is
 * what turns a give-up into a row instead of a log line.
 *
 * A separate instance rather than a share of an existing pool, for the reason
 * `emailPool` and `subscriptionPool` are separate: the work here is a
 * cold-starting Node action carrying JSDOM and BlockNote, and a run of it must
 * not sit in the parallelism slots that notification or mail delivery needs.
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

const pool = new Workpool(components.transcriptPool, {
  // One ingestion per transcribed call that ended — a handful a day in a busy
  // workspace, and each one holds a Node isolate with JSDOM in it. Two is
  // enough to keep a pair of simultaneous call endings from queueing.
  maxParallelism: 2,
  retryActionsByDefault: true,
  // Five attempts over ~15s. The failures this rides out are a cold Node start
  // and an OCC conflict on the document write; a conversion that cannot parse
  // its own bytes fails identically on every attempt and lands in
  // `backgroundJobFailures` either way.
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 1_000, base: 2 },
});

/**
 * Enqueue one transcript ingestion.
 *
 * **Restart safety.** Every attempt re-runs the whole conversion from the
 * stored bytes. That is safe because the action converges rather than
 * accumulates: it re-reads `callSessions.transcriptDocumentId` on the way in
 * and gives up its own document if it loses the attach race, so a replayed
 * attempt produces one document or none — never a second one.
 */
export async function scheduleTranscriptIngest<
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
