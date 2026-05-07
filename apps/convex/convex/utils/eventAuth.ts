import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Throws unless `userId` is the event's organizer. Centralises the
 * `event.createdBy !== userId` check repeated across update / cancel /
 * remove / addInvitees / removeInvitee.
 *
 * `verb` is interpolated into the error message so callers don't have
 * to write per-mutation copy ("Only the organizer can update / cancel /
 * remove / add invitees / remove invitees").
 */
export function assertOrganizer(
  event: Doc<"calendarEvents">,
  userId: Id<"users">,
  verb: string,
): void {
  if (event.createdBy !== userId) {
    throw new ConvexError(`Only the organizer can ${verb}`);
  }
}
