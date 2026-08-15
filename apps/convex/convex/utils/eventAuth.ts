import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * A *narrowing* applied on top of the workspace rule, never a substitute for
 * it. Centralises the `event.createdBy !== userId` check repeated across
 * update / updateEventTags / cancel / addInvitees / removeInvitee / selfInvite.
 *
 * `membership` is unused at runtime, and deliberately so: its only job is to
 * make a membership-less call unrepresentable. The predecessor signature
 * (`event, userId, verb`) took no membership, so every call site paired it with
 * a bare `requireUser` — and an organizer removed from the workspace kept the
 * power to rewrite, re-invite and cascade-delete their old events, and to mint
 * guest share links against a workspace they had left. Pass the `membership`
 * from `requireWorkspaceMember(ctx, event.workspaceId)`; that call is the gate,
 * this is the product decision about which member may act.
 *
 * Same lesson, same shape as `requireCreatorOrWorkspaceAdmin` in
 * `authHelpers.ts`, which replaced the identically-broken `requireCreator`.
 * Unlike that one, this stays organizer-only: admins are NOT admitted, so an
 * event whose organizer is offboarded can no longer be edited or cancelled by
 * anyone — accepted deliberately rather than widening who may rewrite someone
 * else's meeting.
 *
 * `verb` is interpolated into the error message so callers don't have
 * to write per-mutation copy ("Only the organizer can update / cancel /
 * remove / add invitees / remove invitees").
 */
export function assertOrganizer(
  event: Doc<"calendarEvents">,
  userId: Id<"users">,
  membership: Doc<"workspaceMembers">,
  verb: string,
): void {
  if (event.createdBy !== userId) {
    throw new ConvexError(`Only the organizer can ${verb}`);
  }
}
