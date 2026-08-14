/**
 * Retention for the `convex-webhook-receiver` component's own tables.
 *
 * Both webhook routes hand the component a 30-day `expiresInMs`, which it
 * writes as `expiresAt` on `webhookEvents` and `webhookDedup` — and nothing
 * ever read it back. The rows carry the complete raw delivery body (issue and
 * PR payloads run 20–80 KB) plus the full header map, the plaintext
 * `x-hub-signature-256` / `x-gitlab-token` included, so the declared policy not
 * running meant unbounded growth *and* an unbounded window on those headers.
 *
 * Same situation `emailMaintenance.ts` was written to solve for the resend
 * component: the component ships the cleanup and schedules none of it, leaving
 * the policy to the app. The difference is that this one's sweeper was
 * registered as an `internalMutation`, which keeps it out of the component's
 * export table entirely — unreachable from here at runtime, not merely
 * untyped. `patches/convex-webhook-receiver@1.0.6.patch` makes it public and
 * gives it a `limit`; this is the drain that pages it.
 */

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./functions";

/**
 * Rows per transaction. The bodies are the reason this is not larger: a few
 * hundred deliveries at 20–80 KB each is already megabytes of reads, and the
 * component's helper reads whole documents to delete them.
 */
const SWEEP_BATCH = 100;

export const pruneWebhookEvents = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { batchSize }) => {
    const limit = batchSize ?? SWEEP_BATCH;
    const result = await ctx.runMutation(
      components.webhookReceiver.event.mutations.sweepExpired,
      { limit },
    );

    // Re-schedule while a batch comes back full, rather than sweeping the
    // backlog in one transaction. A deployment that has been accumulating
    // since before this cron existed has months of expired rows on its first
    // run; collecting them all at once would blow the read limit on that run
    // and on every run after it — never making progress, which is worse than
    // never having swept. Each continuation is its own transaction, so the
    // work already done stays done.
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.webhookMaintenance.pruneWebhookEvents,
        { batchSize: limit },
      );
    }
    return null;
  },
});
