import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { notify } from "./notify";

// ---------------------------------------------------------------------------
// Calendar-event notification dispatch
//
// Centralises the in-app notify + email scheduling fan-out that was
// duplicated across `create`, `update`, `cancel`, and `addInvitees`.
// Each mutation now describes WHAT happened (the discriminated `action`)
// and WHO is affected (memberRecipientIds + guestRows); this helper
// figures out which email handler to schedule, which category to flag
// for preference filtering, and what in-app notification copy to use.
// ---------------------------------------------------------------------------

/** Build the in-app calendar deep-link used as the email CTA for
 *  internal member invitees. SITE_URL is set per Convex environment. */
function calendarDeepLink(workspaceId: string, eventId: string): string {
  const base = process.env.SITE_URL ?? "";
  return `${base}/workspaces/${workspaceId}/dashboard/calendar?event=${eventId}`;
}

/** Build the public guest landing URL used as the email CTA for guests. */
function shareDeepLink(shareId: string): string {
  const base = process.env.SITE_URL ?? "";
  return `${base}/share/${shareId}`;
}

/** Look up emails for a list of user ids, skipping users without one. */
async function loadRecipientEmails(
  ctx: MutationCtx,
  userIds: Id<"users">[],
): Promise<Array<{ userId: Id<"users">; email: string }>> {
  const docs = await Promise.all(userIds.map((uid) => ctx.db.get(uid)));
  const out: Array<{ userId: Id<"users">; email: string }> = [];
  for (let i = 0; i < userIds.length; i++) {
    const doc = docs[i];
    if (doc?.email) out.push({ userId: userIds[i]!, email: doc.email });
  }
  return out;
}

async function getInviterName(
  ctx: MutationCtx,
  inviterId: Id<"users">,
): Promise<string> {
  const inviter = await ctx.db.get(inviterId);
  return inviter?.name ?? inviter?.email ?? "Someone";
}

/**
 * What kind of dispatch to perform. The kind drives:
 *   • The notification category used for preference filtering.
 *   • The in-app notify title/body/url copy.
 *   • The email handler to schedule (sendEventInvite / sendEventReschedule
 *     / sendEventCancellation), if any.
 *
 * `updated-meta` is the only kind that skips emails entirely — minor
 * field edits go in-app only because they don't warrant a reschedule
 * notification in the recipient's external calendar.
 */
export type EventNotifyAction =
  | { kind: "invited"; sequence: number }
  | { kind: "updated-meta" }
  | { kind: "updated-time"; newRangeLabel: string; sequence: number }
  | { kind: "cancelled"; sequence: number };

export interface DispatchEventNotificationsArgs {
  event: Doc<"calendarEvents">;
  inviterId: Id<"users">;
  action: EventNotifyAction;
  /** Internal members to notify in-app + email (subject to per-user prefs). */
  memberRecipientIds: Id<"users">[];
  /** Guest invitee rows to email — `shareId` is required for "invited"
   *  (used to build the guest landing CTA). `guestEmail` is required
   *  for any kind. */
  guestRows: Array<{ shareId?: string; guestEmail?: string }>;
}

export async function dispatchEventNotifications(
  ctx: MutationCtx,
  args: DispatchEventNotificationsArgs,
): Promise<void> {
  const { event, inviterId, action, memberRecipientIds, guestRows } = args;
  if (memberRecipientIds.length === 0 && guestRows.length === 0) return;

  const inviterName = await getInviterName(ctx, inviterId);
  const eventTitle = event.title;

  // --- In-app notify (members only) ----------------------------------
  if (memberRecipientIds.length > 0) {
    if (action.kind === "invited") {
      await notify(ctx, {
        category: "eventInvited",
        userId: inviterId,
        userName: inviterName,
        title: "Calendar invitation",
        body: `${inviterName} invited you to ${eventTitle}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: memberRecipientIds,
      });
    } else if (action.kind === "updated-meta" || action.kind === "updated-time") {
      await notify(ctx, {
        category: "eventUpdated",
        userId: inviterId,
        userName: inviterName,
        title: "Calendar event updated",
        body: `${inviterName} updated ${eventTitle}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar?event=${event._id}`,
        recipientIds: memberRecipientIds,
      });
    } else {
      // cancelled — drop the event= deep-link param since the event is gone.
      await notify(ctx, {
        category: "eventCancelled",
        userId: inviterId,
        userName: inviterName,
        title: "Calendar event cancelled",
        body: `${inviterName} cancelled ${eventTitle}`,
        url: `/workspaces/${event.workspaceId}/dashboard/calendar`,
        recipientIds: memberRecipientIds,
      });
    }
  }

  // --- Email path ----------------------------------------------------
  if (action.kind === "updated-meta") return;

  const memberEmailRecipients =
    memberRecipientIds.length > 0
      ? await ctx.runQuery(
          internal.notificationPreferences.filterUsersWantingEmail,
          {
            userIds: memberRecipientIds,
            category:
              action.kind === "invited"
                ? "eventInvited"
                : action.kind === "cancelled"
                  ? "eventCancelled"
                  : "eventUpdated",
          },
        )
      : [];
  const memberEmails = await loadRecipientEmails(ctx, memberEmailRecipients);

  if (action.kind === "invited") {
    // Guests use the share landing CTA; members use the in-app calendar CTA.
    for (const row of guestRows) {
      if (!row.guestEmail || !row.shareId) continue;
      await ctx.scheduler.runAfter(0, internal.emails.sendEventInvite, {
        eventId: event._id,
        targetUrl: shareDeepLink(row.shareId),
        recipientEmail: row.guestEmail,
        inviterName,
        eventTitle,
        eventDescription: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        sequence: action.sequence,
      });
    }
    for (const { email } of memberEmails) {
      await ctx.scheduler.runAfter(0, internal.emails.sendEventInvite, {
        eventId: event._id,
        targetUrl: calendarDeepLink(event.workspaceId, event._id),
        recipientEmail: email,
        inviterName,
        eventTitle,
        eventDescription: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        sequence: action.sequence,
      });
    }
    return;
  }

  if (action.kind === "updated-time") {
    for (const row of guestRows) {
      if (!row.guestEmail) continue;
      await ctx.scheduler.runAfter(0, internal.emails.sendEventReschedule, {
        eventId: event._id,
        eventTitle,
        recipientEmail: row.guestEmail,
        inviterName,
        newRangeLabel: action.newRangeLabel,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        sequence: action.sequence,
      });
    }
    for (const { email } of memberEmails) {
      await ctx.scheduler.runAfter(0, internal.emails.sendEventReschedule, {
        eventId: event._id,
        eventTitle,
        recipientEmail: email,
        inviterName,
        newRangeLabel: action.newRangeLabel,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        sequence: action.sequence,
      });
    }
    return;
  }

  // cancelled
  for (const row of guestRows) {
    if (!row.guestEmail) continue;
    await ctx.scheduler.runAfter(0, internal.emails.sendEventCancellation, {
      eventId: event._id,
      eventTitle,
      recipientEmail: row.guestEmail,
      inviterName,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      sequence: action.sequence,
    });
  }
  for (const { email } of memberEmails) {
    await ctx.scheduler.runAfter(0, internal.emails.sendEventCancellation, {
      eventId: event._id,
      eventTitle,
      recipientEmail: email,
      inviterName,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      sequence: action.sequence,
    });
  }
}
