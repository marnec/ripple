import { describe, it, expect } from "vitest";
import { parseTranscriptWebhook } from "../convex/transcriptWebhook";

/**
 * Direct unit tests for the webhook payload parser — the event-filter +
 * field-extraction branching that previously lived inside the httpAction and
 * was only reachable through an HTTP request. The shape tolerance here is the
 * bit most likely to break when Cloudflare changes its envelope.
 */
describe("parseTranscriptWebhook", () => {
  it("delivers from the documented shape (meeting.id + top-level url)", () => {
    const raw = JSON.stringify({
      event: "meeting.transcript",
      meeting: { id: "m-1", sessionId: "s-1" },
      transcriptDownloadUrl: "https://cf/transcript.csv",
    });
    expect(parseTranscriptWebhook(raw)).toEqual({
      kind: "deliver",
      meetingId: "m-1",
      sessionId: "s-1",
      transcriptDownloadUrl: "https://cf/transcript.csv",
    });
  });

  it("accepts fallbacks: top-level meetingId and meeting.transcriptDownloadUrl", () => {
    const raw = JSON.stringify({
      type: "meeting.transcript",
      meetingId: "m-2",
      meeting: { transcriptDownloadUrl: "https://cf/t.json" },
    });
    expect(parseTranscriptWebhook(raw)).toEqual({
      kind: "deliver",
      meetingId: "m-2",
      transcriptDownloadUrl: "https://cf/t.json",
    });
  });

  it("omits sessionId when absent", () => {
    const raw = JSON.stringify({
      event: "meeting.transcript",
      meeting: { id: "m-3" },
      transcriptDownloadUrl: "https://cf/t.vtt",
    });
    const result = parseTranscriptWebhook(raw);
    expect(result.kind).toBe("deliver");
    expect(result).not.toHaveProperty("sessionId");
  });

  it("delivers when no event field is present (meeting + url is enough)", () => {
    const raw = JSON.stringify({
      meeting: { id: "m-4" },
      transcriptDownloadUrl: "https://cf/t.csv",
    });
    expect(parseTranscriptWebhook(raw)).toMatchObject({
      kind: "deliver",
      meetingId: "m-4",
    });
  });

  it("ignores non-transcript events", () => {
    const raw = JSON.stringify({ event: "meeting.started", meeting: { id: "m" } });
    expect(parseTranscriptWebhook(raw)).toEqual({ kind: "ignore" });
  });

  it("reports invalid when the meeting id is missing", () => {
    const raw = JSON.stringify({
      event: "meeting.transcript",
      transcriptDownloadUrl: "https://cf/t.csv",
    });
    expect(parseTranscriptWebhook(raw)).toEqual({ kind: "invalid" });
  });

  it("reports invalid when the download url is missing", () => {
    const raw = JSON.stringify({
      event: "meeting.transcript",
      meeting: { id: "m-5" },
    });
    expect(parseTranscriptWebhook(raw)).toEqual({ kind: "invalid" });
  });

  it("ignores non-string field values rather than coercing them", () => {
    const raw = JSON.stringify({
      event: "meeting.transcript",
      meeting: { id: 12345 },
      transcriptDownloadUrl: "https://cf/t.csv",
    });
    expect(parseTranscriptWebhook(raw)).toEqual({ kind: "invalid" });
  });

  it("reports malformed for non-JSON bodies", () => {
    expect(parseTranscriptWebhook("not json")).toEqual({ kind: "malformed" });
    expect(parseTranscriptWebhook("")).toEqual({ kind: "malformed" });
  });
});
