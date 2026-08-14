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
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

/** Names one queued message: the failure record, and the row it belongs to. */
export type EmailJob = {
  /** The sending action, as `module:function`. */
  kind: string;
  /** Names the mail when the recipient has no invitee row of their own. */
  eventId: Id<"calendarEvents">;
  /**
   * The delivery-tracking row, when there is one. A member notified by
   * preference rather than by invitation has none, and their mail is untracked
   * on the way out for the same reason it goes unrecorded on the way down.
   */
  inviteeId?: Id<"calendarEventInvitees">;
};

/**
 * Enqueue one calendar email. The action classifies its own failures
 * (`utils/emailErrors.ts`): a transient one throws and lands back here for
 * another attempt, a permanent one throws `NonRetryableError` and stops.
 *
 * The `onComplete` is what makes the last transient attempt distinguishable
 * from the four before it. Without one the exhausted case wrote nothing
 * anywhere: the send path leaves the row alone on every transient failure by
 * design, so the row kept `waiting` — "still going out" — and the give-up
 * reached neither the organizer nor `admin/jobs`.
 *
 * Unlike its two sibling pools this one does not point at
 * `backgroundJobFailures.recordTerminalFailure` directly, because the invitee
 * row has to be corrected in the same transaction as the operator record.
 */
export async function scheduleEmail<
  Fn extends FunctionReference<"action", "internal"> & SchedulableFunctionReference,
>(
  ctx: MutationCtx,
  fn: Fn,
  job: EmailJob,
  ...args: OptionalRestArgs<Fn>
): Promise<void> {
  await pool.enqueueAction(ctx, fn, ...(args as [any]), {
    onComplete: internal.emailDelivery.recordEmailTerminalFailure,
    context: {
      kind: job.kind,
      // The invitee row is the better handle where it exists: it names the
      // recipient as well as the event. Untracked mail falls back to the event.
      key: job.inviteeId ?? job.eventId,
      inviteeId: job.inviteeId,
    },
  });
}
