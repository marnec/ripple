"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";
import { Resend } from "resend";
import { APP_NAME, EMAIL_DOMAIN } from "@ripple/shared/constants"

export const sendWorkspaceInvite = internalAction({
  args: {
    inviteId: v.id("workspaceInvites"),
    workspaceName: v.string(),
    inviterName: v.string(),
    recipientEmail: v.string(),
  },
  returns: v.null(),
  handler: async (_, { inviteId, workspaceName, inviterName, recipientEmail }) => {
    const url = `${process.env.SITE_URL}/invite/${inviteId}`;

    const emailContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#18181b;">${APP_NAME}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#71717a;">Workspace Invitation</p>
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${inviterName}</strong> invited you to join <strong>${workspaceName}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:14px;color:#52525b;line-height:1.5;">
            Accept the invitation to start collaborating.
          </p>
          <a href="${url}" style="display:inline-block;padding:10px 28px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
            Accept Invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            Or copy this link: <a href="${url}" style="color:#71717a;">${url}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f4f4f5;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">
            If you didn't expect this invitation, you can ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const resendKey = process.env.AUTH_RESEND_KEY;

    if (!resendKey) {
      throw new ConvexError("Missing Resend API key");
    }

    const resend = new Resend(resendKey);

    const sent = await resend.emails.send({
      from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>`,
      to: recipientEmail,
      subject: `Invitation to join ${workspaceName} on ${APP_NAME}`,
      html: emailContent,
    });

    if (sent.error) {
      throw new ConvexError(`Failed to send email: ${sent.error.message}`);
    }

    return null;
  },
});

// ─── Calendar event invitations ──────────────────────────────────────────
// Mirrors sendWorkspaceInvite. The "View invitation" CTA URL is supplied
// by the caller via `targetUrl`: guests get the public /share/:shareId
// entry, internal members get the in-app calendar deep-link. The action
// does no queries — all event metadata is passed inline by the
// scheduling mutation.

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

type IcsMethod = "REQUEST" | "CANCEL";

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

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Calendar//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method}`,
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsUtcStamp(Date.now())}`,
    `DTSTART:${icsUtcStamp(opts.startsAt)}`,
    `DTEND:${icsUtcStamp(opts.endsAt)}`,
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
  return `${eventId}@${EMAIL_DOMAIN}`;
}

function organizerAddress(): string {
  return `noreply@${EMAIL_DOMAIN}`;
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
async function sendCalendarEmail(opts: {
  to: string;
  subject: string;
  html: string;
  ics: string;
  method: IcsMethod;
}): Promise<void> {
  const resendKey = process.env.AUTH_RESEND_KEY;
  if (!resendKey) throw new ConvexError("Missing Resend API key");
  const resend = new Resend(resendKey);

  const sent = await resend.emails.send({
    from: `${APP_NAME} <noreply@${EMAIL_DOMAIN}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: [icsAttachment(opts.ics, opts.method)],
  });

  if (sent.error) {
    throw new ConvexError(`Failed to send email: ${sent.error.message}`);
  }
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
  },
  returns: v.null(),
  handler: async (
    _,
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
    });

    const html = renderEventEmailLayout({
      subhead: "Calendar invitation",
      bodyHtml: `
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${inviterName}</strong> invited you to <strong>${eventTitle}</strong>.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#52525b;line-height:1.5;">${when}</p>
          <a href="${targetUrl}" style="display:inline-block;padding:10px 28px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">
            View invitation
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
            Or copy this link: <a href="${targetUrl}" style="color:#71717a;">${targetUrl}</a>
          </p>`,
    });

    await sendCalendarEmail({
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
  },
  returns: v.null(),
  handler: async (
    _,
    {
      eventId,
      eventTitle,
      recipientEmail,
      inviterName,
      newRangeLabel,
      startsAt,
      endsAt,
      sequence,
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
    });

    const html = renderEventEmailLayout({
      subhead: "Event rescheduled",
      bodyHtml: `
          <p style="margin:0 0 16px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${inviterName}</strong> rescheduled <strong>${eventTitle}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><td style="padding:12px 16px;background:#f4f4f5;border-radius:8px;">
              <p style="margin:0;font-size:13px;color:#71717a;line-height:1.4;">New time</p>
              <p style="margin:4px 0 0;font-size:14px;color:#18181b;font-weight:500;line-height:1.4;">${newRangeLabel}</p>
            </td></tr>
          </table>`,
    });

    await sendCalendarEmail({
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
  },
  returns: v.null(),
  handler: async (
    _,
    {
      eventId,
      eventTitle,
      recipientEmail,
      inviterName,
      startsAt,
      endsAt,
      sequence,
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
    });

    const html = renderEventEmailLayout({
      subhead: "Event cancelled",
      bodyHtml: `
          <p style="margin:0 0 8px;font-size:15px;color:#27272a;line-height:1.5;">
            <strong>${inviterName}</strong> cancelled <strong>${eventTitle}</strong>.
          </p>
          <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">
            The previously shared invitation link is no longer valid.
          </p>`,
    });

    await sendCalendarEmail({
      to: recipientEmail,
      subject: `Cancelled: ${eventTitle}`,
      html,
      ics,
      method: "CANCEL",
    });
    return null;
  },
});