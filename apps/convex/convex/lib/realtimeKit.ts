/**
 * The one place Ripple talks to Cloudflare RealtimeKit (RTK) over HTTP.
 *
 * Every call surface — channel calls, calendar-event calls, guest share links,
 * the cascaded voice agent — needs the same three operations (create a meeting,
 * add a participant, delete an orphaned meeting), against the same REST shape,
 * with the same `Bearer` auth. Before this module each call site hand-rolled
 * the URL, headers, response parsing, and the env-var load; the Cloudflare lore
 * (which body fields mean what, the `"multi"` language trap) was scattered as
 * comments next to whichever `fetch` happened to need it.
 *
 * `createRealtimeKitClient(creds)` binds the credentials once and returns the
 * three operations. `realtimeKitFromEnv()` is the production constructor —
 * loads + validates the env vars. Tests construct a fake `RealtimeKitClient`
 * directly, which is what makes the race-safe meeting creation in
 * `ensureMeetingForChannel` unit-testable without a live Cloudflare account.
 *
 * Errors: a non-2xx response throws `RealtimeKitError` (carries operation +
 * status + body for logs). Callers decide the user-facing message — a host
 * starting a call, a guest joining via a share link, and the agent invite all
 * surface different errors. `deleteMeeting` is fire-and-forget: it swallows and
 * logs failures so orphan cleanup never fails a join.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

export class RealtimeKitError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`RealtimeKit ${operation} failed (${status}): ${body}`);
    this.name = "RealtimeKitError";
  }
}

export interface RtkCredentials {
  accountId: string;
  appId: string;
  apiToken: string;
}

export interface CreateMeetingOptions {
  title: string;
  /**
   * Produce the consolidated end-of-call transcript (Whisper) delivered by the
   * `meeting.transcript` webhook. On Cloudflare a meeting is either
   * real-time-transcribed OR end-of-meeting-transcribed, never both — Ripple
   * chose end-of-meeting (server-side, survives everyone leaving). When omitted,
   * the meeting is created with no end-of-call transcript.
   */
  transcribeOnEnd?: boolean;
  /**
   * Pins the Whisper language (ISO 639-1, e.g. `es`). Only applied alongside
   * `transcribeOnEnd`. Without it the Whisper path defaults to English and
   * blanks other languages.
   *
   * Do NOT pass `"multi"` (auto-detect): verified 2026-06-06 that Cloudflare
   * accepts it at meeting-create (echoes it back) but its end-of-meeting Whisper
   * pipeline then silently produces no transcript and never fires the
   * `meeting.transcript` webhook. `"multi"` is a real-time-only (Deepgram)
   * value; there is no auto-detect for end-of-meeting transcription.
   */
  transcriptionLanguage?: string;
}

export interface AddParticipantOptions {
  name: string;
  picture?: string;
  presetName: string;
  customParticipantId: string;
}

export interface RealtimeKitClient {
  createMeeting(opts: CreateMeetingOptions): Promise<{ id: string }>;
  addParticipant(
    meetingId: string,
    opts: AddParticipantOptions,
  ): Promise<{ token: string }>;
  /** Fire-and-forget orphan cleanup; never throws. */
  deleteMeeting(meetingId: string): Promise<void>;
}

export function createRealtimeKitClient(
  creds: RtkCredentials,
): RealtimeKitClient {
  const base = `${CF_API_BASE}/${creds.accountId}/realtime/kit/${creds.appId}`;
  const headers = {
    Authorization: `Bearer ${creds.apiToken}`,
    "Content-Type": "application/json",
  };

  return {
    async createMeeting({ title, transcribeOnEnd, transcriptionLanguage }) {
      const res = await fetch(`${base}/meetings`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title,
          ...(transcribeOnEnd !== undefined
            ? { transcribe_on_end: transcribeOnEnd }
            : {}),
          ...(transcribeOnEnd && transcriptionLanguage
            ? { ai_config: { transcription: { language: transcriptionLanguage } } }
            : {}),
        }),
      });
      if (!res.ok) {
        throw new RealtimeKitError("createMeeting", res.status, await res.text());
      }
      const data = (await res.json()) as { data: { id: string } };
      return { id: data.data.id };
    },

    async addParticipant(meetingId, opts) {
      const res = await fetch(`${base}/meetings/${meetingId}/participants`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: opts.name,
          ...(opts.picture !== undefined ? { picture: opts.picture } : {}),
          preset_name: opts.presetName,
          custom_participant_id: opts.customParticipantId,
        }),
      });
      if (!res.ok) {
        throw new RealtimeKitError(
          "addParticipant",
          res.status,
          await res.text(),
        );
      }
      const data = (await res.json()) as { data: { token: string } };
      return { token: data.data.token };
    },

    async deleteMeeting(meetingId) {
      try {
        await fetch(`${base}/meetings/${meetingId}`, {
          method: "DELETE",
          headers,
        });
      } catch (e) {
        console.error("RealtimeKit deleteMeeting failed:", e);
      }
    },
  };
}

/**
 * Production constructor: load + validate the RTK credentials from the
 * environment. Throws a plain `Error` (a server-config fault, not user-facing)
 * if any are missing.
 */
export function realtimeKitFromEnv(): RealtimeKitClient {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const appId = process.env.CLOUDFLARE_RTK_APP_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !appId || !apiToken) {
    throw new Error(
      "Missing Cloudflare RealtimeKit environment variables. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_RTK_APP_ID, and CLOUDFLARE_API_TOKEN.",
    );
  }
  return createRealtimeKitClient({ accountId, appId, apiToken });
}
