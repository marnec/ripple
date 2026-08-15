/**
 * The read side of the webhook receiver's dead-letter queue.
 *
 * A delivery that fails every attempt is marked `"dead"` and moved to the
 * component's `webhookDlq` table — and no Ripple surface read it. Inbound sync
 * simply gave up: the task stayed diverged from the provider, `lastSyncError`
 * never fired (that chip is outbound-only), and `admin/jobs` showed nothing.
 * Thirty days later `webhookMaintenance.pruneWebhookEvents` deletes the entry
 * along with its event, so even the trace expired.
 *
 * This mirrors each dead delivery onto `backgroundJobFailures`, the table that
 * already means "Ripple promised to finish this and didn't", and runs on the
 * daily cron *ahead of* the sweep that would otherwise erase the evidence.
 */

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./functions";
import { insertJobFailure } from "./backgroundJobFailures";
import { advanceWatermark, readWatermark } from "./jobWatermarks";

/** Names this drain on the rows it writes. */
export const DLQ_FAILURE_KIND = "webhookReceiver:dead";

/** Where this job keeps its place in the DLQ. */
const WATERMARK_JOB = "webhookReceiver:dlqMirror";

/**
 * Entries reported per transaction.
 *
 * Naming a dead delivery means reading the event it points at, and those rows
 * carry the complete raw body — issue and PR payloads run 20–80 KB. A repo
 * whose payload shape Ripple cannot apply produces a *run* of dead deliveries,
 * so the first mirror after a bad day, or the first after this shipped, faces
 * a backlog rather than one row. Same reasoning, and same paging, as
 * `webhookMaintenance.pruneWebhookEvents`.
 */
const MIRROR_BATCH = 25;

/**
 * The two component rows this reads. Spelled out because the component's
 * generated types reach this app through a `_generated/component.js` specifier
 * its `exports` map does not carry, so `ctx.runQuery` widens them to `any` —
 * the same reason `webhookMaintenance` reads `result.isDone` untyped.
 */
type DlqEntry = { eventId: string; movedAt: number; _creationTime: number };
type StoredEvent = { provider: string; lastError?: string } | null;

export const mirrorDeadDeliveries = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { batchSize }) => {
    const limit = batchSize ?? MIRROR_BATCH;
    const watermark = await readWatermark(ctx, WATERMARK_JOB);

    // `listDlq` is unpaged, but the rows are four fields wide; the read that
    // has to be bounded is `getEvent` below.
    const entries: DlqEntry[] = await ctx.runQuery(
      components.webhookReceiver.event.queries.listDlq,
      {},
    );

    // `_creationTime` rather than the entry's own `movedAt`: `movedAt` is a
    // `Date.now()` stamp, so a burst of deliveries dying together can tie, and
    // a tie straddling a batch boundary would strand the later entry above a
    // watermark that had already passed it. Convex's `_creationTime` is
    // strictly increasing within a table, which is exactly the total order a
    // high-water mark needs.
    const fresh = entries
      .filter((e) => e._creationTime > watermark)
      .sort((a, b) => a._creationTime - b._creationTime)
      .slice(0, limit);

    for (const entry of fresh) {
      const event: StoredEvent = await ctx.runQuery(
        components.webhookReceiver.event.queries.getEvent,
        { eventId: entry.eventId },
      );
      await insertJobFailure(ctx, {
        kind: DLQ_FAILURE_KIND,
        key: entry.eventId,
        // The provider is on the row rather than in `kind`, so the operator
        // list keeps one bucket per drain and a GitHub and a GitLab give-up
        // read the same way.
        error: `${event?.provider ?? "unknown"}: ${
          event?.lastError ?? "inbound delivery exhausted its attempts"
        }`,
      });
      // Inside the loop, so the mark can only ever describe work that is
      // already written — and in the same transaction, so the two commit or
      // roll back together.
      await advanceWatermark(ctx, WATERMARK_JOB, entry._creationTime);
    }

    // Continue while a batch came back full, rather than reading a month of
    // bodies in one transaction. Each continuation is its own transaction, so
    // the entries already reported stay reported.
    if (fresh.length === limit) {
      await ctx.scheduler.runAfter(
        0,
        internal.webhookDlqMirror.mirrorDeadDeliveries,
        { batchSize: limit },
      );
    }

    return null;
  },
});
