/**
 * The retry machinery for calendar mail.
 *
 * Workspace invites do not come through here: `@convex-dev/resend`'s
 * `sendEmail` already queues, batches and retries them internally. Calendar
 * mail cannot use that path — the batch endpoint carries no attachments, and
 * every calendar message carries the ICS whose ORGANIZER is the RSVP ingestion
 * route — so it sends with `sendEmailManually`, which tracks status but
 * explicitly does *not* queue or retry. This pool is that missing half.
 *
 * A separate instance rather than a share of `notificationPool`: a Resend
 * outage backs mail up for as long as the backoff runs, and in a shared pool
 * that backlog would occupy the same parallelism slots push delivery needs.
 * The two failure domains stay apart.
 *
 * No `process.env.VITEST` branch. The three older pool wrappers had one, on the
 * assumption that component mutations do not work under `convex-test`; they do,
 * which is what the phase-0 spike established, and a test-only bypass would
 * mean the retry configured here was exercised by nothing. Those branches are
 * now gone too — every pool in this codebase is the real pool under test.
 */

import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type {
  FunctionReference,
  SchedulableFunctionReference,
  OptionalRestArgs,
} from "convex/server";

const pool = new Workpool(components.emailPool, {
  // Resend's own limit is 10 req/s and the component paces itself at roughly
  // 1.7/s; four in flight leaves that headroom intact while still draining a
  // 200-invitee fan-out promptly.
  maxParallelism: 4,
  retryActionsByDefault: true,
  // Five attempts over ~30s of backoff. Long enough to ride out a rate-limit
  // burst or a brief Resend outage; short enough that a genuinely undeliverable
  // message reaches its `failed` state while the organizer is still looking.
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2_000, base: 2 },
});

/**
 * Enqueue one calendar email. The action classifies its own failures
 * (`utils/emailErrors.ts`): a transient one throws and lands back here for
 * another attempt, a permanent one throws `NonRetryableError` and stops.
 */
export async function scheduleEmail<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  await pool.enqueueAction(ctx, fn, ...(args as [any]));
}
