/**
 * Pure parse of a Cloudflare RealtimeKit `meeting.transcript` webhook body into
 * the delivery we schedule ingest from. Free of any Convex / `"use node"` deps
 * so `http.ts` (default runtime) can import it and it's unit-testable in
 * isolation (see `tests/transcriptWebhook.test.ts`).
 *
 * Cloudflare's payload shape (verified 2026-06-06):
 *   { event, meeting: { id, sessionId, ... }, transcriptDownloadUrl, ... }
 * The meeting id is `meeting.id` (NOT a top-level `meetingId`) and the download
 * URL is top-level. We accept a couple of fallbacks for safety, and we ack
 * (rather than reject) events we don't handle so Cloudflare stops retrying them.
 */
export type TranscriptWebhookResult =
  | { kind: "malformed" } // body isn't JSON → 400
  | { kind: "ignore" } // a non-transcript event → ack 200, do nothing
  | { kind: "invalid" } // transcript event missing required fields → 400
  | {
      kind: "deliver";
      meetingId: string;
      sessionId?: string;
      transcriptDownloadUrl: string;
    };

export function parseTranscriptWebhook(
  rawBody: string,
): TranscriptWebhookResult {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { kind: "malformed" };
  }

  const event = (body.event ?? body.type) as string | undefined;
  if (event && event !== "meeting.transcript") return { kind: "ignore" };

  const meeting = (body.meeting as Record<string, unknown> | undefined) ?? {};
  const asStr = (x: unknown): string | undefined =>
    typeof x === "string" ? x : undefined;
  const meetingId = asStr(meeting.id) ?? asStr(body.meetingId);
  const sessionId = asStr(meeting.sessionId) ?? asStr(body.sessionId);
  const transcriptDownloadUrl =
    asStr(body.transcriptDownloadUrl) ?? asStr(meeting.transcriptDownloadUrl);

  if (!meetingId || !transcriptDownloadUrl) return { kind: "invalid" };

  return {
    kind: "deliver",
    meetingId,
    ...(sessionId ? { sessionId } : {}),
    transcriptDownloadUrl,
  };
}
