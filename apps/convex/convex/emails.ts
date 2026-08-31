"use node";

import { ConvexError, v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sendTrackedEmail } from "./emailDelivery";
import { Resend } from "resend";
import { APP_NAME, EMAIL_FROM_DOMAIN, EMAIL_RSVP_DOMAIN } from "@ripple/shared/constants"
// The escape lives with the templates so both senders — this file and the
// component-backed invite path — share one copy of the invariant it documents.
import { escapeHtml } from "./emailTemplates";

// ─── Calendar event invitations ──────────────────────────────────────────
// The "View invitation" CTA URL is supplied by the caller via `targetUrl`:
// guests get the public /share/:shareId entry, internal members get the
// in-app calendar deep-link. The action does no queries — all event metadata
// is passed inline by the scheduling mutation.
//
// These are the last senders still holding their own Resend client. The
// workspace invite moved to `@convex-dev/resend` (see `emailDelivery.ts`),
// which cannot carry the ICS attachment these three depend on; they get the
// same durability from a workpool in T6 phase 2.

// ─── ICS (iCalendar) builder ─────────────────────────────────────────────
// Minimal RFC 5545 generator used to attach a `text/calendar` part to
// invite / reschedule / cancel emails. Mail clients (Gmail, Outlook,
// Apple Mail, Fastmail…) detect the attachment and render their own
// native Yes / Maybe / No RSVP UI plus add the event to the recipient's
// calendar — without requiring the recipient to click through to the
// Ripple web app. Replies (METHOD:REPLY) are not yet ingested; the body
// link to /share/${shareId} stays as the canonical RSVP path.

const ICS_LINE_LIMIT = 73; // RFC 5545: lines must fold past 75 octets; 73 leaves headroom.

/** Escape a TEXT property value per RFC 5545 §3.3.11. */
function icsEscapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold a single content line so no physical line exceeds 75 octets. */
function icsFoldLine(line: string): string {
  if (line.length <= ICS_LINE_LIMIT) return line;
  const parts: string[] = [line.slice(0, ICS_LINE_LIMIT)];
  let i = ICS_LINE_LIMIT;
  while (i < line.length) {
    parts.push(line.slice(i, i + ICS_LINE_LIMIT - 1));
    i += ICS_LINE_LIMIT - 1;
  }
  return parts.join("\r\n ");
}

/** Format ms-since-epoch as the basic UTC form: YYYYMMDDTHHMMSSZ. */
function icsUtcStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Format ms-since-epoch as iCalendar's *local* form in `timeZone`:
 * YYYYMMDDTHHMMSS, with no trailing Z. Paired with a `TZID` parameter this is
 * what makes a repeating meeting keep its wall-clock time — see
 * `IcsRecurrence` for why the master entry uses it and nothing else does.
 */
function icsLocalStamp(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const at = (type: string) => parts.find((p) => p.type === type)!.value;
  return (
    `${at("year")}${at("month")}${at("day")}` +
    `T${at("hour")}${at("minute")}${at("second")}`
  );
}

type IcsMethod = "REQUEST" | "CANCEL";

/**
 * One occurrence that has been moved or re-worded away from its series — an
 * **override**. Each becomes a second `VEVENT` under the same UID, identified
 * by the `RECURRENCE-ID` of the start the rule originally placed it at, so the
 * recipient's client shows that Tuesday at its new time instead of the
 * pattern's.
 */
interface IcsOverride {
  /** The start the rule placed it at — its name, forever. */
  originalStartMs: number;
  startsAt: number;
  endsAt: number;
  title: string;
  description?: string;
}

/**
 * What turns a single `VEVENT` into a whole repeating pattern.
 *
 * `rrule` and `exdate` are produced by `@ripple/shared/recurrence`
 * (`toRRule` / `toExDate`) and passed through untouched: the rule text has one
 * home and this file is not it.
 *
 * **On timezones.** The master `DTSTART`/`DTEND` go out as local wall-clock
 * times with a `TZID` parameter rather than as UTC instants, because that is
 * the only encoding under which a 09:00 standup is still at 09:00 after the
 * clocks change — which is the whole reason a series is anchored to a local
 * time (ADR 0002). The `EXDATE`s and `RECURRENCE-ID`s stay UTC instants, which
 * is what the recurrence module produces and what our own expansion means;
 * both sides land on the same instants because both use the same IANA rules.
 *
 * No `VTIMEZONE` component is emitted: every mail client we care about
 * resolves a well-known IANA `TZID` from its own database, and writing our own
 * transition rules would mean shipping a second, staler copy of tzdata.
 */
interface IcsRecurrence {
  /** RRULE value, e.g. "FREQ=WEEKLY;BYDAY=TU". */
  rrule: string;
  /** EXDATE value — cancelled occurrences — when the series has skipped any. */
  exdate?: string;
  /** IANA zone the series' wall-clock anchor is expressed in. */
  timezone: string;
  overrides: IcsOverride[];
}

/**
 * The recurrence block as it crosses the action boundary. Mirrors
 * `IcsRecurrence`, and sits next to it so that changing one is changing a
 * validator three lines away.
 */
const recurrenceValidator = v.object({
  rrule: v.string(),
  exdate: v.optional(v.string()),
  timezone: v.string(),
  overrides: v.array(
    v.object({
      originalStartMs: v.number(),
      startsAt: v.number(),
      endsAt: v.number(),
      title: v.string(),
      description: v.optional(v.string()),
    }),
  ),
});

interface BuildIcsOpts {
  uid: string;                    // stable across the event's lifetime
  method: IcsMethod;
  sequence: number;
  startsAt: number;
  endsAt: number;
  title: string;
  description?: string;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  attendeeName?: string;
  url?: string;                   // back-link to the Ripple share page
  /** Present exactly when this UID names a **series** rather than one event. */
  recurrence?: IcsRecurrence;
}

function buildEventIcs(opts: BuildIcsOpts): string {
  const status = opts.method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const partstat = opts.method === "CANCEL" ? "DECLINED" : "NEEDS-ACTION";

  const organizer =
    `ORGANIZER;CN=${icsEscapeText(opts.organizerName)}:mailto:${opts.organizerEmail}`;
  const attendee =
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};RSVP=TRUE` +
    (opts.attendeeName ? `;CN=${icsEscapeText(opts.attendeeName)}` : "") +
    `:mailto:${opts.attendeeEmail}`;

  const recurrence = opts.recurrence;
  const tz = recurrence?.timezone;

  const start = tz
    ? `DTSTART;TZID=${tz}:${icsLocalStamp(opts.startsAt, tz)}`
    : `DTSTART:${icsUtcStamp(opts.startsAt)}`;
  const end = tz
    ? `DTEND;TZID=${tz}:${icsLocalStamp(opts.endsAt, tz)}`
    : `DTEND:${icsUtcStamp(opts.endsAt)}`;

  // One extra VEVENT per override, all under the same UID. A CANCEL carries
  // none: withdrawing the series withdraws every occurrence of it, and naming
  // the moved ones separately would only ask the client to reconcile entries
  // it is about to delete.
  const overrideEvents =
    opts.method === "CANCEL" || !tz
      ? []
      : (recurrence?.overrides ?? []).flatMap((o) => [
          "BEGIN:VEVENT",
          `UID:${opts.uid}`,
          `RECURRENCE-ID:${icsUtcStamp(o.originalStartMs)}`,
          `DTSTAMP:${icsUtcStamp(Date.now())}`,
          `DTSTART;TZID=${tz}:${icsLocalStamp(o.startsAt, tz)}`,
          `DTEND;TZID=${tz}:${icsLocalStamp(o.endsAt, tz)}`,
          `SUMMARY:${icsEscapeText(o.title)}`,
          ...(o.description ? [`DESCRIPTION:${icsEscapeText(o.description)}`] : []),
          ...(opts.url ? [`URL:${opts.url}`] : []),
          organizer,
          attendee,
          // The series' own counter, deliberately: there is one SEQUENCE for
          // the whole pattern (spec 0003, "Email and ICS"), and an override
          // row's own `sequence` field is left unwritten.
          `SEQUENCE:${opts.sequence}`,
          "STATUS:CONFIRMED",
          "TRANSP:OPAQUE",
          "END:VEVENT",
        ]);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Calendar//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method}`,
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsUtcStamp(Date.now())}`,
    start,
    end,
    ...(recurrence ? [`RRULE:${recurrence.rrule}`] : []),
    ...(recurrence?.exdate ? [`EXDATE:${recurrence.exdate}`] : []),
    `SUMMARY:${icsEscapeText(opts.title)}`,
    ...(opts.description
      ? [`DESCRIPTION:${icsEscapeText(opts.description)}`]
      : []),
    ...(opts.url ? [`URL:${opts.url}`] : []),
    organizer,
    attendee,
    `SEQUENCE:${opts.sequence}`,
    `STATUS:${status}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    ...overrideEvents,
    "END:VCALENDAR",
  ];

  // RFC 5545 mandates CRLF line endings; many clients are lenient but
  // Outlook is famously not.
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}

interface IcsAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function icsAttachment(ics: string, method: IcsMethod): IcsAttachment {
  return {
    filename: "invite.ics",
    content: Buffer.from(ics, "utf-8"),
    contentType: `text/calendar; method=${method}; charset=utf-8; name=invite.ics`,
  };
}

function eventUid(eventId: string): string {
  return `${eventId}@${EMAIL_RSVP_DOMAIN}`;
}

// ICS ORGANIZER must point at a routable inbox so mail clients' Yes / Maybe /
// No buttons mail their METHOD:REPLY to somewhere we can ingest. Cloudflare
// Email Routing forwards `rsvp@${EMAIL_RSVP_DOMAIN}` to the rsvp-worker
// package (packages/rsvp-worker), which parses the REPLY and updates
// calendarEventInvitees.status via /calendar/rsvp. Note: the SMTP `From:` on
// outbound mail stays `noreply@${EMAIL_FROM_DOMAIN}` (Resend-verified) so
// threaded replies don't pollute the RSVP mailbox — clients honour ICS
// ORGANIZER over From.
function organizerAddress(): string {
  return `rsvp@${EMAIL_RSVP_DOMAIN}`;
}

// ─── Email helpers ───────────────────────────────────────────────────────

/**
 * Shared HTML layout for calendar lifecycle emails. Each variant
 * provides its own `subhead` (the small grey label below the brand
 * heading) and `bodyHtml` (the message-specific block). The outer
 * table chrome, brand line, and footer copy are constant across
 * invite / reschedule / cancellation, so changes to the visual
 * frame land in one place.
 */
function renderEventEmailLayout(opts: {
  subhead: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#18181b;">${APP_NAME}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#71717a;">${opts.subhead}</p>
          ${opts.bodyHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Resend wiring for calendar lifecycle emails. Centralises the
 * API-key guard, client construction, and error mapping that was
 * duplicated across the three sendEvent* actions.
 */
async function sendCalendarEmail(
  ctx: ActionCtx,
  opts: {
    inviteeId?: Id<"calendarEventInvitees">;
    to: string;
    subject: string;
    html: string;
    ics: string;
    method: IcsMethod;
  },
): Promise<void> {
  const resendKey = process.env.AUTH_RESEND_KEY;
  if (!resendKey) throw new ConvexError("Missing Resend API key");
  const resend = new Resend(resendKey);

  await sendTrackedEmail(ctx, {
    inviteeId: opts.inviteeId,
    to: opts.to,
    subject: opts.subject,
    send: async (idempotencyKey) => {
      const sent = await resend.emails.send(
        {
          from: `${APP_NAME} <noreply@${EMAIL_FROM_DOMAIN}>`,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
          attachments: [icsAttachment(opts.ics, opts.method)],
        },
        // Per-attempt, because the component mints a fresh id per attempt.
        // Guards the one window a retry cannot otherwise cover: a send that
        // succeeded whose response was lost.
        { idempotencyKey },
      );

      if (sent.error) {
        return {
          kind: "error",
          code: sent.error.name,
          status: (sent.error as { statusCode?: number }).statusCode,
          message: sent.error.message,
        };
      }
      return { kind: "sent", resendId: sent.data!.id };
    },
  });
}

function formatEventDateTime(
  startsAt: number,
  endsAt: number,
  timezone: string,
): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const start = fmt.format(new Date(startsAt));
  const endFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const end = endFmt.format(new Date(endsAt));
  return `${start} – ${end}`;
}

export const sendEventInvite = internalAction({
  args: {
    eventId: v.string(),       // calendarEvents._id, used for the ICS UID
    /** Absolute URL the recipient lands on when they click "View invitation".
     *  Caller decides: guests get `${SITE_URL}/share/${shareId}`; internal
     *  members get the in-app calendar deep-link. Embedded in both the
     *  HTML body and the ICS X-ALT-DESC for client deep-linking. */
    targetUrl: v.string(),
    recipientEmail: v.string(),
    inviterName: v.string(),
    eventTitle: v.string(),
    eventDescription: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.string(),
    sequence: v.number(),
    /** The row this message is announcing, so the send can record its own
     *  outcome. Optional: a recipient may have no invitee row (a member
     *  notified by preference rather than by invitation). */
    inviteeId: v.optional(v.id("calendarEventInvitees")),
    /** Set when `eventId` names a **series**: the whole repeating pattern
     *  travels in this one message, so the recipient's client files it as one
     *  entry rather than one per occurrence. */
    recurrence: v.optional(recurrenceValidator),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      eventId,
      targetUrl,
      recipientEmail,
      inviterName,
      eventTitle,
      eventDescription,
      startsAt,
      endsAt,
      timezone,
      sequence,
      inviteeId,
      recurrence,
    },
  ) => {
    const when = formatEventDateTime(startsAt, endsAt, timezone);

    const ics = buildEventIcs({
      uid: eventUid(eventId),
      method: "REQUEST",
      sequence,
      startsAt,
      endsAt,
      title: eventTitle,
      description: eventDescription,
      organizerEmail: organizerAddress(),
      organizerName: inviterName,
      attendeeEmail: recipientEmail,
      url: targetUrl,
      recurrence,
    });

    const html = renderEventEmailLayout({
      subhead: "Calendar invitation",
      bodyHtml: `
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${escapeHtml(inviterName)}</strong> invited you to <strong>${escapeHtml(eventTitle)}</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#52525b;line-height:1.5;">${escapeHtml(when)}</p>
          <a href="${escapeHtml(targetUrl)}" style="display:inline-block;padding:10px 28px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
            View invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            Or copy this link: <a href="${escapeHtml(targetUrl)}" style="color:#71717a;">${escapeHtml(targetUrl)}</a>
          </p>`,
    });

    await sendCalendarEmail(ctx, {
      inviteeId,
      to: recipientEmail,
      subject: `Invitation: ${eventTitle}`,
      html,
      ics,
      method: "REQUEST",
    });
    return null;
  },
});

/**
 * Email sent when an organizer reschedules an event (drag-to-reschedule
 * or resize on the calendar). Includes the new window so guests don't
 * have to open the calendar to see what changed. Mirrors the visual
 * shape of `sendEventInvite` / `sendEventCancellation` so the three
 * lifecycle messages read as a series.
 */
export const sendEventReschedule = internalAction({
  args: {
    eventId: v.string(),       // for the ICS UID (must match the original invite)
    eventTitle: v.string(),
    recipientEmail: v.string(),
    inviterName: v.string(),
    /** Pre-formatted human-readable range, e.g. "Mon, May 4 · 10:00 AM – 11:00 AM".
     *  Pre-formatted server-side because the recipient's locale isn't
     *  necessarily known here; we format using the organizer's locale,
     *  which matches the existing invite/cancellation emails. */
    newRangeLabel: v.string(),
    // New ICS times — METHOD:REQUEST with a bumped SEQUENCE makes the
    // recipient's mail client update the previously-added calendar entry
    // in place (rather than creating a duplicate).
    startsAt: v.number(),
    endsAt: v.number(),
    sequence: v.number(),
    /** The row this message is announcing, so the send can record its own
     *  outcome. Optional: a recipient may have no invitee row (a member
     *  notified by preference rather than by invitation). */
    inviteeId: v.optional(v.id("calendarEventInvitees")),
    /** Set when `eventId` names a **series**: the update re-states the whole
     *  pattern, including every override, so a moved occurrence lands at its
     *  new time in the recipient's client. */
    recurrence: v.optional(recurrenceValidator),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      eventId,
      eventTitle,
      recipientEmail,
      inviterName,
      newRangeLabel,
      startsAt,
      endsAt,
      sequence,
      inviteeId,
      recurrence,
    },
  ) => {
    const ics = buildEventIcs({
      uid: eventUid(eventId),
      method: "REQUEST",
      sequence,
      startsAt,
      endsAt,
      title: eventTitle,
      organizerEmail: organizerAddress(),
      organizerName: inviterName,
      attendeeEmail: recipientEmail,
      recurrence,
    });

    const html = renderEventEmailLayout({
      subhead: "Event rescheduled",
      bodyHtml: `
          <p style="margin:0 0 16px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${escapeHtml(inviterName)}</strong> rescheduled <strong>${escapeHtml(eventTitle)}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><td style="padding:12px 16px;background:#f4f4f5;border-radius:8px;">
              <p style="margin:0;font-size:13px;color:#71717a;line-height:1.4;">New time</p>
              <p style="margin:4px 0 0;font-size:14px;color:#18181b;font-weight:500;line-height:1.4;">${escapeHtml(newRangeLabel)}</p>
            </td></tr>
          </table>`,
    });

    await sendCalendarEmail(ctx, {
      inviteeId,
      to: recipientEmail,
      subject: `Rescheduled: ${eventTitle}`,
      html,
      ics,
      method: "REQUEST",
    });
    return null;
  },
});

export const sendEventCancellation = internalAction({
  args: {
    eventId: v.string(),       // for the ICS UID (must match the original invite)
    eventTitle: v.string(),
    recipientEmail: v.string(),
    inviterName: v.string(),
    // The original event window is required so the CANCEL VEVENT
    // matches the request the recipient's calendar previously imported;
    // some clients (Outlook in particular) ignore CANCEL messages whose
    // DTSTART differs from the stored copy.
    startsAt: v.number(),
    endsAt: v.number(),
    sequence: v.number(),
    /** The row this message is announcing, so the send can record its own
     *  outcome. Optional: a recipient may have no invitee row (a member
     *  notified by preference rather than by invitation). */
    inviteeId: v.optional(v.id("calendarEventInvitees")),
    /** Set when `eventId` names a **series**: the CANCEL has to carry the same
     *  RRULE the client stored, or it withdraws only the first occurrence. */
    recurrence: v.optional(recurrenceValidator),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      eventId,
      eventTitle,
      recipientEmail,
      inviterName,
      startsAt,
      endsAt,
      sequence,
      inviteeId,
      recurrence,
    },
  ) => {
    const ics = buildEventIcs({
      uid: eventUid(eventId),
      method: "CANCEL",
      sequence,
      startsAt,
      endsAt,
      title: eventTitle,
      organizerEmail: organizerAddress(),
      organizerName: inviterName,
      attendeeEmail: recipientEmail,
      recurrence,
    });

    const html = renderEventEmailLayout({
      subhead: "Event cancelled",
      bodyHtml: `
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${escapeHtml(inviterName)}</strong> cancelled <strong>${escapeHtml(eventTitle)}</strong>.
          </p>
          <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">
            The previously shared invitation link is no longer valid.
          </p>`,
    });

    await sendCalendarEmail(ctx, {
      inviteeId,
      to: recipientEmail,
      subject: `Cancelled: ${eventTitle}`,
      html,
      ics,
      method: "CANCEL",
    });
    return null;
  },
});