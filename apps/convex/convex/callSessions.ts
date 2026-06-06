import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireUser } from "./authHelpers";

export const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/**
 * Race-safe wrapper that returns the Cloudflare meetingId for a channel.
 *
 * The race: two parallel callers both see `getActiveSession` return null,
 * both POST to Cloudflare to create a meeting, both try to persist. Only
 * one `createSession` mutation wins — the loser's CF meeting is orphaned
 * and burns quota until CF idle-cleans it.
 *
 * Fix: if we lose the race (createSession returns the winner's id instead
 * of null), DELETE our orphan on Cloudflare. Fire-and-forget; a failed
 * cleanup logs to console but does not fail the join.
 */
export async function ensureMeetingForChannel(
  ctx: ActionCtx,
  channelId: Id<"channels">,
  cf: { accountId: string; appId: string; apiToken: string },
  transcribe: boolean,
): Promise<{ meetingId: string; transcribe: boolean }> {
  const headers = {
    Authorization: `Bearer ${cf.apiToken}`,
    "Content-Type": "application/json",
  };

  const session = await ctx.runQuery(internal.callSessions.getActiveSession, {
    channelId,
  });
  // An active call already exists — its transcription mode was fixed when the
  // first joiner created the meeting; we reuse it (a late joiner can't flip it).
  if (session)
    return {
      meetingId: session.cloudflareMeetingId,
      transcribe: session.transcribe ?? false,
    };

  const createRes = await fetch(
    `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings`,
    {
      method: "POST",
      headers,
      // `transcribe_on_end` produces the consolidated end-of-call transcript
      // (Whisper) that the `meeting.transcript` webhook delivers. On Cloudflare
      // a meeting is either real-time-transcribed OR end-of-meeting-transcribed,
      // never both — we chose end-of-meeting (server-side, survives everyone
      // leaving). Independent of recording.
      body: JSON.stringify({
        title: `Channel call ${channelId}`,
        transcribe_on_end: transcribe,
      }),
    },
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    console.error("Cloudflare create-meeting failed:", createRes.status, err);
    throw new Error("Could not start the call");
  }
  const createData = (await createRes.json()) as { data: { id: string } };
  const ourMeetingId = createData.data.id;

  const winner = await ctx.runMutation(internal.callSessions.createSession, {
    channelId,
    cloudflareMeetingId: ourMeetingId,
    transcribe,
  });

  if (winner && winner.cloudflareMeetingId !== ourMeetingId) {
    // We lost the race — our CF meeting is orphaned. Clean it up so it
    // doesn't tie up Cloudflare participant / meeting quota. The winner's
    // transcription mode wins (ours never took effect).
    void fetch(
      `${CF_API_BASE}/${cf.accountId}/realtime/kit/${cf.appId}/meetings/${ourMeetingId}`,
      { method: "DELETE", headers },
    ).catch((e) => console.error("Orphan meeting cleanup failed:", e));
    return { meetingId: winner.cloudflareMeetingId, transcribe: winner.transcribe };
  }
  return { meetingId: ourMeetingId, transcribe };
}

const callSessionValidator = v.object({
  _id: v.id("callSessions"),
  _creationTime: v.number(),
  channelId: v.id("channels"),
  cloudflareMeetingId: v.string(),
  active: v.boolean(),
  transcribe: v.optional(v.boolean()),
  cloudflareSessionId: v.optional(v.string()),
  transcriptDocumentId: v.optional(v.id("documents")),
});

export const getActiveSession = internalQuery({
  args: { channelId: v.id("channels") },
  returns: v.union(callSessionValidator, v.null()),
  handler: async (ctx, { channelId }) => {
    return await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .first();
  },
});

export const createSession = internalMutation({
  args: {
    channelId: v.id("channels"),
    cloudflareMeetingId: v.string(),
    transcribe: v.boolean(),
  },
  // null = we won the race (our meeting is now the active session). An object
  // = we lost; the returned row is the winner whose transcription mode applies.
  returns: v.union(
    v.null(),
    v.object({ cloudflareMeetingId: v.string(), transcribe: v.boolean() }),
  ),
  handler: async (ctx, { channelId, cloudflareMeetingId, transcribe }) => {
    // Check inside the mutation (transactional) to prevent duplicate sessions
    const existing = await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .first();

    if (existing) {
      return {
        cloudflareMeetingId: existing.cloudflareMeetingId,
        transcribe: existing.transcribe ?? false,
      };
    }

    await ctx.db.insert("callSessions", {
      channelId,
      cloudflareMeetingId,
      active: true,
      transcribe,
    });
    return null;
  },
});

export const endSession = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    await requireUser(ctx);

    const sessions = await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .collect();

    for (const session of sessions) {
      await ctx.db.patch(session._id, { active: false });
    }
    return null;
  },
});

/**
 * RealtimeKit presets (configured in the Cloudflare dashboard). They differ
 * only in their `transcription_enabled` flag, which gates real-time captions
 * and whether a participant's audio feeds the live transcript. The per-call
 * toggle picks between them; the end-of-call transcript doc is driven
 * separately by `transcribe_on_end` on the meeting.
 */
const PRESET_TRANSCRIBE = "group_call_host";
const PRESET_NO_TRANSCRIBE = "group_call_host_notranscript";

export const joinCall = action({
  args: {
    channelId: v.id("channels"),
    userName: v.string(),
    userImage: v.optional(v.string()),
    // The starter's lobby choice. Only honoured when this caller creates the
    // meeting; joiners of an existing call inherit that call's mode.
    transcribe: v.optional(v.boolean()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
  }),
  handler: async (ctx, { channelId, userName, userImage, transcribe }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const appId = process.env.CLOUDFLARE_RTK_APP_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !appId || !apiToken) {
      throw new Error(
        "Missing Cloudflare RealtimeKit environment variables. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_RTK_APP_ID, and CLOUDFLARE_API_TOKEN.",
      );
    }

    const headers = {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    };

    const { meetingId, transcribe: effectiveTranscribe } =
      await ensureMeetingForChannel(
        ctx,
        channelId,
        { accountId, appId, apiToken },
        transcribe ?? false,
      );

    // Add this user as a participant. The preset must match the call's mode so
    // a late joiner to a transcribed call also gets captions and feeds the
    // live transcript.
    const participantRes = await fetch(
      `${CF_API_BASE}/${accountId}/realtime/kit/${appId}/meetings/${meetingId}/participants`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: userName,
          picture: userImage,
          preset_name: effectiveTranscribe
            ? PRESET_TRANSCRIBE
            : PRESET_NO_TRANSCRIBE,
          custom_participant_id: userId,
        }),
      },
    );

    if (!participantRes.ok) {
      const err = await participantRes.text();
      throw new Error(`Failed to add participant: ${err}`);
    }

    const participantData = await participantRes.json();
    const authToken = (participantData as { data: { token: string } }).data
      .token;

    return { authToken, meetingId };
  },
});

/**
 * Look up a call session by its Cloudflare meeting id. Used by the transcript
 * webhook ingest to resolve a `meeting.transcript` delivery back to its channel
 * and workspace. The row persists after the call ends (`active: false`), so
 * this resolves even though the call is over by the time the webhook fires.
 */
export const getSessionByMeeting = internalQuery({
  args: { cloudflareMeetingId: v.string() },
  returns: v.union(callSessionValidator, v.null()),
  handler: async (ctx, { cloudflareMeetingId }) => {
    return await ctx.db
      .query("callSessions")
      .withIndex("by_meeting", (q) =>
        q.eq("cloudflareMeetingId", cloudflareMeetingId),
      )
      .first();
  },
});

/**
 * Channel name + workspace for the transcript ingest (no auth — invoked from
 * the webhook action, which has already resolved the session by meeting id).
 */
export const getChannelForTranscript = internalQuery({
  args: { channelId: v.id("channels") },
  returns: v.union(
    v.object({ name: v.string(), workspaceId: v.id("workspaces") }),
    v.null(),
  ),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;
    return { name: channel.name, workspaceId: channel.workspaceId };
  },
});

/**
 * Attach the seeded transcript document to its call session. Idempotency guard
 * for the webhook: returns false if a document was already attached (a
 * duplicate delivery), so the caller can discard its freshly-built doc.
 */
export const attachTranscriptDocument = internalMutation({
  args: {
    sessionId: v.id("callSessions"),
    documentId: v.id("documents"),
    cloudflareSessionId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { sessionId, documentId, cloudflareSessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return false;
    // Already linked → genuine duplicate. The documents delete-trigger keeps
    // this FK consistent (cleared on doc deletion), so it never dangles.
    if (session.transcriptDocumentId) return false;
    await ctx.db.patch(sessionId, {
      transcriptDocumentId: documentId,
      ...(cloudflareSessionId ? { cloudflareSessionId } : {}),
    });
    return true;
  },
});
