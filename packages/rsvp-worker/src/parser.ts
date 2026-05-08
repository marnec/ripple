// MIME -> ICS REPLY -> ParsedRsvp.
//
// Mail clients vary wildly in how they pack the REPLY:
//   - Gmail: top-level `text/calendar; method=REPLY` part
//   - Apple Mail: multipart/mixed with an `invite.ics` attachment, body is text/plain
//   - Outlook: ICS embedded as both inline part and attachment, sometimes
//     omitting SEQUENCE on REPLY (we default to 0).
//
// postal-mime exposes every non-html/non-text part as an `Attachment` with a
// top-level `method?` parameter pulled from the content-type — convenient for
// us. We accept any attachment whose mimeType starts with `text/calendar`
// AND `method === "REPLY"`, falling back to any `.ics` whose body contains
// METHOD:REPLY.

import PostalMime, { type Attachment, type Email, type RawEmail } from "postal-mime";
import ICAL from "ical.js";
import type { ParsedRsvp, Partstat } from "./types";

/**
 * Parse a raw inbound MIME stream and extract the RSVP. Returns null if the
 * mail isn't an ICS REPLY — caller logs and drops.
 */
export async function parseRsvp(raw: RawEmail): Promise<ParsedRsvp | null> {
  const parser = new PostalMime();
  const email = await parser.parse(raw);

  const icsText = findIcsReply(email);
  if (!icsText) return null;

  return extractRsvp(icsText);
}

function findIcsReply(email: Email): string | null {
  const parts = email.attachments;

  // Pass 1: explicit text/calendar with method=REPLY parameter.
  for (const p of parts) {
    if (!p.mimeType.toLowerCase().startsWith("text/calendar")) continue;
    if ((p.method ?? "").toUpperCase() !== "REPLY") continue;
    const text = decodeContent(p);
    if (text && text.includes("BEGIN:VCALENDAR")) return text;
  }

  // Pass 2: any text/calendar (or .ics) part that *contains* METHOD:REPLY.
  // Some forwarders strip the content-type parameter.
  for (const p of parts) {
    const isCal =
      p.mimeType.toLowerCase().startsWith("text/calendar") ||
      (p.filename ?? "").toLowerCase().endsWith(".ics");
    if (!isCal) continue;
    const text = decodeContent(p);
    if (text && /METHOD:REPLY/i.test(text)) return text;
  }

  return null;
}

function decodeContent(att: Attachment): string | null {
  const c = att.content as unknown;
  if (typeof c === "string") {
    if (att.encoding === "base64") {
      try {
        return atob(c);
      } catch {
        return null;
      }
    }
    return c;
  }
  if (c instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(c));
  }
  // postal-mime returns Uint8Array (or Node Buffer) for binary content
  // depending on the runtime; both satisfy ArrayBuffer.isView.
  if (ArrayBuffer.isView(c)) {
    const view = c as ArrayBufferView;
    return new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  return null;
}

/**
 * Pull the RSVP-relevant fields from a VCALENDAR string. Returns null on
 * structural problems (missing VEVENT/UID/DTSTAMP/ATTENDEE or unmappable
 * PARTSTAT) — caller logs and drops.
 */
export function extractRsvp(icsText: string): ParsedRsvp | null {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(icsText);
  } catch {
    return null;
  }
  const vcal = new ICAL.Component(jcal as never);
  const vevent = vcal.getFirstSubcomponent("vevent");
  if (!vevent) return null;

  const uid = vevent.getFirstPropertyValue("uid");
  if (typeof uid !== "string" || uid.length === 0) return null;

  const dtstampProp = vevent.getFirstProperty("dtstamp");
  if (!dtstampProp) return null;
  // ICAL.Time -> JS Date -> ms epoch. DTSTAMP is UTC per RFC 5545.
  const dtstampVal = dtstampProp.getFirstValue() as ICAL.Time | null;
  const dtstamp = dtstampVal ? dtstampVal.toJSDate().getTime() : NaN;
  if (!Number.isFinite(dtstamp)) return null;

  const seqRaw = vevent.getFirstPropertyValue("sequence");
  const sequence =
    typeof seqRaw === "number" && Number.isFinite(seqRaw) ? seqRaw : 0;

  const attendee = vevent.getFirstProperty("attendee");
  if (!attendee) return null;

  const partstatRaw =
    (attendee.getParameter("partstat") as string | undefined) ?? "";
  const partstat = normalizePartstat(partstatRaw);
  if (!partstat) return null;

  const attendeeValue = attendee.getFirstValue();
  if (typeof attendeeValue !== "string") return null;
  const attendeeEmail = stripMailto(attendeeValue).toLowerCase();
  if (!attendeeEmail.includes("@")) return null;

  return { uid, attendeeEmail, partstat, dtstamp, sequence };
}

function normalizePartstat(raw: string): Partstat | null {
  const v = raw.trim().toUpperCase();
  if (v === "ACCEPTED") return "ACCEPTED";
  if (v === "DECLINED") return "DECLINED";
  if (v === "TENTATIVE") return "TENTATIVE";
  // NEEDS-ACTION / DELEGATED / COMPLETED / IN-PROCESS — drop, no Convex
  // status maps cleanly and they're never sent by mail-client RSVP buttons.
  return null;
}

function stripMailto(s: string): string {
  return s.replace(/^mailto:/i, "");
}
