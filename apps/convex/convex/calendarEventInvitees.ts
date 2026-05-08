// Inbound RSVP entry point for the rsvp-worker (packages/rsvp-worker).
//
// When a recipient clicks Yes / Maybe / No on the calendar card their mail
// client renders, the client mails a `text/calendar; method=REPLY` ICS to
// the address in the original ICS `ORGANIZER:mailto:` (now
// `rsvp@${EMAIL_DOMAIN}` — see emails.ts `organizerAddress`). Cloudflare
// Email Routing forwards that mail to the rsvp-worker, which parses the
// REPLY, verifies authenticity (DKIM/DMARC + From-vs-ATTENDEE), and POSTs
// to the `/calendar/rsvp` HTTP route in http.ts. That route calls this
// internal mutation.
//
// The web-app RSVP path (`calendarEvents.respond` / `respondAsGuest`)
// stays where it is — this file is the parallel email path.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { EMAIL_DOMAIN } from "@ripple/shared/constants";
import { notify } from "./utils/notify";

const partstatValidator = v.union(
  v.literal("ACCEPTED"),
  v.literal("DECLINED"),
  v.literal("TENTATIVE"),
);

const reasonValidator = v.union(
  v.literal("stale"),
  v.literal("unknown_event"),
  v.literal("unknown_attendee"),
  v.literal("event_cancelled"),
);

const PARTSTAT_TO_STATUS = {
  ACCEPTED: "accepted" as const,
  DECLINED: "declined" as const,
  TENTATIVE: "tentative" as const,
};

/**
 * Apply a verified ICS REPLY to a calendar event invitee row.
 *
 * Idempotency rules (in order):
 *   1. `sequence < event.sequence` → REPLY is for an obsolete invite version,
 *      drop. Outlook in particular re-sends old REPLYs on resync.
 *   2. `sequence < invitee.lastRsvpSequence` → strictly older, drop.
 *   3. `sequence === invitee.lastRsvpSequence && dtstamp <= invitee.lastRsvpDtstamp`
 *      → same version, not strictly newer DTSTAMP, drop.
 *
 * Note: NEEDS-ACTION and DELEGATED PARTSTATs are filtered out at the worker
 * boundary (parser.ts) — only the three actionable values reach here.
 */
export const recordEmailRsvp = internalMutation({
  args: {
    uid: v.string(),
    attendeeEmail: v.string(),
    partstat: partstatValidator,
    dtstamp: v.number(),
    sequence: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    reason: v.optional(reasonValidator),
  }),
  handler: async (ctx, { uid, attendeeEmail, partstat, dtstamp, sequence }) => {
    // 1. Decode UID — built by emails.ts `eventUid()` as
    //    `${eventId}@${EMAIL_DOMAIN}`. A foreign UID hitting our mailbox
    //    means the recipient forwarded our invite to a third-party
    //    invitation system, or this is an unrelated email; drop.
    const atIdx = uid.indexOf("@");
    if (atIdx <= 0) {
      return { applied: false, reason: "unknown_event" as const };
    }
    const rawEventId = uid.slice(0, atIdx);
    const uidDomain = uid.slice(atIdx + 1);
    if (uidDomain !== EMAIL_DOMAIN) {
      return { applied: false, reason: "unknown_event" as const };
    }

    // ctx.db.normalizeId returns null when the string isn't a valid Id of
    // the given table (wrong shape, deployment-mismatched, etc.) — safer
    // than blindly casting.
    const eventId = ctx.db.normalizeId("calendarEvents", rawEventId);
    if (!eventId) {
      return { applied: false, reason: "unknown_event" as const };
    }

    const event = await ctx.db.get(eventId);
    if (!event) {
      return { applied: false, reason: "unknown_event" as const };
    }
    if (event.cancelledAt !== undefined) {
      return { applied: false, reason: "event_cancelled" as const };
    }

    // 2. Locate invitee row. Members are matched by linking the email to a
    //    users row first, then `by_event_user`. Guests have no user row —
    //    fall back to `by_event_guest_email`. Email comparison is
    //    case-insensitive (worker already lowercases, but defend in depth).
    const normalizedEmail = attendeeEmail.toLowerCase();
    const invitee = await locateInvitee(ctx, eventId, normalizedEmail);
    if (!invitee) {
      return { applied: false, reason: "unknown_attendee" as const };
    }

    // 3. Idempotency.
    const eventSeq = event.sequence ?? 0;
    if (sequence < eventSeq) {
      return { applied: false, reason: "stale" as const };
    }
    if (
      invitee.lastRsvpSequence !== undefined &&
      sequence < invitee.lastRsvpSequence
    ) {
      return { applied: false, reason: "stale" as const };
    }
    if (
      invitee.lastRsvpSequence !== undefined &&
      sequence === invitee.lastRsvpSequence &&
      invitee.lastRsvpDtstamp !== undefined &&
      dtstamp <= invitee.lastRsvpDtstamp
    ) {
      return { applied: false, reason: "stale" as const };
    }

    // 4. Patch.
    const newStatus = PARTSTAT_TO_STATUS[partstat];
    await ctx.db.patch(invitee._id, {
      status: newStatus,
      respondedAt: Date.now(),
      lastRsvpDtstamp: dtstamp,
      lastRsvpSequence: sequence,
    });

    // 5. Notify the organizer. Mirrors `calendarEvents.respond` for members
    //    and `respondAsGuest` for guests — guests have no users row so the
    //    notify `userId` (the senderId field on the notification record)
    //    falls back to `event.createdBy`, matching respondAsGuest behaviour.
    //    Skip when the responder IS the organizer (organizer mailbox
    //    happens to receive its own invite).
    const isSelf =
      invitee.userId !== undefined && invitee.userId === event.createdBy;
    if (!isSelf) {
      const responderName = await resolveResponderName(ctx, invitee);
      const guestSuffix = invitee.userId ? "" : " (guest)";
      await notify(ctx, {
        category: "eventResponseChanged",
        userId: invitee.userId ?? event.createdBy,
        userName: responderName,
        title: "Event RSVP",
        body: `${responderName}${guestSuffix} ${newStatus} your invitation to ${event.title}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: [event.createdBy],
      });
    }

    return { applied: true };
  },
});

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function locateInvitee(
  ctx: { db: import("./_generated/server").MutationCtx["db"] },
  eventId: Id<"calendarEvents">,
  emailLower: string,
): Promise<Doc<"calendarEventInvitees"> | null> {
  // Member path: find a users row first (auth's users table has a `email`
  // index — see auth.ts `findVerifiedEmailUser`). We accept any user with
  // that email; account-linking has already collapsed duplicates by the
  // time invites get sent.
  const userRows = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", emailLower))
    .take(2);
  for (const u of userRows) {
    const memberInvitee = await ctx.db
      .query("calendarEventInvitees")
      .withIndex("by_event_user", (q) =>
        q.eq("eventId", eventId).eq("userId", u._id),
      )
      .first();
    if (memberInvitee) return memberInvitee;
  }

  // Guest path.
  const guestInvitee = await ctx.db
    .query("calendarEventInvitees")
    .withIndex("by_event_guest_email", (q) =>
      q.eq("eventId", eventId).eq("guestEmail", emailLower),
    )
    .first();
  return guestInvitee ?? null;
}

async function resolveResponderName(
  ctx: { db: import("./_generated/server").MutationCtx["db"] },
  invitee: Doc<"calendarEventInvitees">,
): Promise<string> {
  if (invitee.userId) {
    const user = await ctx.db.get(invitee.userId);
    if (user?.name) return user.name;
    if (user?.email) return user.email;
  }
  if (invitee.guestName) return invitee.guestName;
  if (invitee.guestEmail) return invitee.guestEmail;
  return "Someone";
}

