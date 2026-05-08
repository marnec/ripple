import { describe, it, expect } from "vitest";
import { extractRsvp, parseRsvp } from "./parser";

const baseIcs = (overrides: Partial<{ partstat: string; sequence: string; uid: string }> = {}) => {
  const partstat = overrides.partstat ?? "ACCEPTED";
  const uid = overrides.uid ?? "k57abc123@conduits.space";
  const seqLine = overrides.sequence === undefined
    ? "SEQUENCE:0\r\n"
    : overrides.sequence === ""
      ? ""
      : `SEQUENCE:${overrides.sequence}\r\n`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Test//EN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260508T120000Z",
    "DTSTART:20260510T140000Z",
    "DTEND:20260510T150000Z",
    `ATTENDEE;PARTSTAT=${partstat};CN=Alice:mailto:Alice@Example.COM`,
    seqLine.trimEnd(),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n") + "\r\n";
};

describe("extractRsvp", () => {
  it("pulls UID, ATTENDEE email (lowercased), PARTSTAT, DTSTAMP, SEQUENCE", () => {
    const r = extractRsvp(baseIcs({ partstat: "ACCEPTED", sequence: "2" }));
    expect(r).not.toBeNull();
    expect(r!.uid).toBe("k57abc123@conduits.space");
    expect(r!.attendeeEmail).toBe("alice@example.com");
    expect(r!.partstat).toBe("ACCEPTED");
    expect(r!.sequence).toBe(2);
    // 2026-05-08T12:00:00Z
    expect(r!.dtstamp).toBe(Date.UTC(2026, 4, 8, 12, 0, 0));
  });

  it("defaults SEQUENCE to 0 when missing (Outlook REPLYs)", () => {
    const r = extractRsvp(baseIcs({ sequence: "" }));
    expect(r!.sequence).toBe(0);
  });

  it("returns null for unknown PARTSTAT (NEEDS-ACTION/DELEGATED)", () => {
    expect(extractRsvp(baseIcs({ partstat: "NEEDS-ACTION" }))).toBeNull();
    expect(extractRsvp(baseIcs({ partstat: "DELEGATED" }))).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(extractRsvp("not actually iCalendar")).toBeNull();
  });

  it("recognizes DECLINED and TENTATIVE", () => {
    expect(extractRsvp(baseIcs({ partstat: "DECLINED" }))!.partstat).toBe(
      "DECLINED",
    );
    expect(extractRsvp(baseIcs({ partstat: "TENTATIVE" }))!.partstat).toBe(
      "TENTATIVE",
    );
  });
});

// ---------------------------------------------------------------------------
// MIME-level smoke test: build a minimal multipart/alternative reply with a
// text/calendar; method=REPLY part and confirm parseRsvp finds it. This is a
// sanity check for the postal-mime integration; deeper variations (Apple
// attachments, base64 encoding, etc.) are covered by extractRsvp directly.
// ---------------------------------------------------------------------------

function buildMimeReply(ics: string): string {
  const boundary = "----=_BOUNDARY_42";
  const lf = "\r\n";
  return [
    "From: Alice <alice@example.com>",
    "To: rsvp@conduits.space",
    "Subject: Accepted: Sync",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "MIME-Version: 1.0",
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Alice has accepted.",
    "",
    `--${boundary}`,
    "Content-Type: text/calendar; method=REPLY; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    ics,
    `--${boundary}--`,
    "",
  ].join(lf);
}

describe("parseRsvp", () => {
  it("extracts the RSVP from a multipart/alternative MIME message", async () => {
    const mime = buildMimeReply(baseIcs({ partstat: "ACCEPTED" }));
    const r = await parseRsvp(mime);
    expect(r).not.toBeNull();
    expect(r!.partstat).toBe("ACCEPTED");
    expect(r!.attendeeEmail).toBe("alice@example.com");
  });

  it("returns null when the mail has no text/calendar part", async () => {
    const mime = [
      "From: Alice <alice@example.com>",
      "To: rsvp@conduits.space",
      "Subject: Out of office",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Sorry, I'm away until next week.",
      "",
    ].join("\r\n");
    const r = await parseRsvp(mime);
    expect(r).toBeNull();
  });

  it("falls back to .ics attachment when method= parameter is absent", async () => {
    // Apple Mail sometimes drops the method= from Content-Type but the body
    // still says METHOD:REPLY.
    const ics = baseIcs({ partstat: "TENTATIVE" });
    const boundary = "----=_BOUNDARY_99";
    const mime = [
      "From: Alice <alice@example.com>",
      "To: rsvp@conduits.space",
      "Subject: Tentative: Sync",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "MIME-Version: 1.0",
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See attached.",
      "",
      `--${boundary}`,
      "Content-Type: text/calendar; charset=utf-8; name=invite.ics",
      'Content-Disposition: attachment; filename="invite.ics"',
      "",
      ics,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const r = await parseRsvp(mime);
    expect(r).not.toBeNull();
    expect(r!.partstat).toBe("TENTATIVE");
  });
});
