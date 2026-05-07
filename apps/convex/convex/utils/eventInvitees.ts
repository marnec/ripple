import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Fetch all invitee rows for an event via the `by_event` index.
 * Centralises the pattern repeated across listMineInRange, get, update,
 * cancel, remove, addInvitees, and the internal recipient collector.
 *
 * Accepts a `QueryCtx`-compatible context (mutation contexts satisfy
 * the constraint via structural typing).
 */
export async function loadInviteeRows(
  ctx: { db: QueryCtx["db"] },
  eventId: Id<"calendarEvents">,
): Promise<Doc<"calendarEventInvitees">[]> {
  return await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
}
