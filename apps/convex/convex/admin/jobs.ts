import { v } from "convex/values";
import { query } from "../_generated/server";
import { mutation } from "../functions";
import { requirePlatformAdmin } from "../authHelpers";

/**
 * The operator's view of `backgroundJobFailures` — the one table that means
 * "Ripple promised to finish this and didn't".
 *
 * Two kinds of row land here, and neither belongs on a workspace screen. A
 * drain that exhausted its retries (`notificationSubscriptionJobs:*`,
 * `tagSync:*`) is Ripple's own denormalization falling behind, which no
 * workspace admin can act on. An abandoned outbound mirror
 * (`integrations.outbound:*`) is user-meaningful, but it already has a
 * per-task home in the product app — the `lastSyncError` chip — and a second
 * parallel surface would only split it. What is left over is the operator's
 * job, and the table is platform-global (no `workspaceId`) to match.
 *
 * Guard-first, so both functions are safe as public API.
 */

/**
 * How many rows one page carries. A drain that fails on a schedule can produce
 * rows indefinitely, so this is a real ceiling rather than a formality — the
 * query reports `truncated` instead of quietly implying it showed everything.
 */
const PAGE_LIMIT = 200;

export const list = query({
  args: {},
  returns: v.object({
    failures: v.array(
      v.object({
        _id: v.id("backgroundJobFailures"),
        kind: v.string(),
        key: v.string(),
        error: v.string(),
        failedAt: v.number(),
      }),
    ),
    /** True when older failures exist beyond this page. */
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    // Newest-first off the default `by_creation_time` index: rows are written
    // once, at failure time, so creation order and `failedAt` order agree —
    // and this needs no index the table doesn't already have.
    const page = await ctx.db
      .query("backgroundJobFailures")
      .order("desc")
      .take(PAGE_LIMIT + 1);

    return {
      failures: page.slice(0, PAGE_LIMIT).map((f) => ({
        _id: f._id,
        kind: f.kind,
        key: f.key,
        error: f.error,
        failedAt: f.failedAt,
      })),
      truncated: page.length > PAGE_LIMIT,
    };
  },
});

/**
 * Clear one row an operator has dealt with.
 *
 * Deleting is the honest verb: nothing re-runs the work, so the row's only
 * remaining job is to be triaged and gone. A list that can never be emptied
 * stops being read, which would put this table back where the logs were.
 */
export const dismiss = mutation({
  args: { failureId: v.id("backgroundJobFailures") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);

    // Two operators on the same list is the expected case, not an error.
    const failure = await ctx.db.get(args.failureId);
    if (!failure) return null;

    await ctx.db.delete(args.failureId);
    return null;
  },
});
