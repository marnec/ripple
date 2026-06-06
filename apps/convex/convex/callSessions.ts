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
import {
  realtimeKitFromEnv,
  type RealtimeKitClient,
} from "./lib/realtimeKit";

/**
 * Race-safe wrapper that returns the Cloudflare meetingId for a channel.
 *
 * The race: two parallel callers both see `getActiveSession` return null,
 * both create a meeting on Cloudflare, both try to persist. Only one
 * `createSession` mutation wins — the loser's CF meeting is orphaned and
 * burns quota until CF idle-cleans it.
 *
 * Fix: if we lose the race (createSession returns the winner's id instead
 * of null), delete our orphan via the client. Fire-and-forget; a failed
 * cleanup logs to console but does not fail the join.
 *
 * Takes the `RealtimeKitClient` as a parameter (rather than reaching for env)
 * so the race recovery can be exercised against a fake client in tests.
 */
export async function ensureMeetingForChannel(
  ctx: ActionCtx,
  channelId: Id<"channels">,
  rtk: RealtimeKitClient,
  transcribe: boolean,
  // ISO 639-1 code (`en`, `es`, …). Only meaningful when `transcribe` is true
  // and we're creating the meeting (the client documents the `"multi"` trap).
  transcriptionLanguage?: string,
): Promise<{ meetingId: string; transcribe: boolean }> {
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

  let ourMeetingId: string;
  try {
    ({ id: ourMeetingId } = await rtk.createMeeting({
      title: `Channel call ${channelId}`,
      transcribeOnEnd: transcribe,
      transcriptionLanguage,
    }));
  } catch (e) {
    console.error("Cloudflare create-meeting failed:", e);
    throw new Error("Could not start the call");
  }

  const winner = await ctx.runMutation(internal.callSessions.createSession, {
    channelId,
    cloudflareMeetingId: ourMeetingId,
    transcribe,
  });

  if (winner && winner.cloudflareMeetingId !== ourMeetingId) {
    // We lost the race — our CF meeting is orphaned. Clean it up so it
    // doesn't tie up Cloudflare participant / meeting quota. The winner's
    // transcription mode wins (ours never took effect).
    void rtk.deleteMeeting(ourMeetingId);
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
    // ISO 639-1 code or `"multi"`. Like `transcribe`, only applied when this
    // caller creates the meeting (it's baked into the Whisper config at
    // creation; late joiners can't change the meeting's language).
    transcriptionLanguage: v.optional(v.string()),
  },
  returns: v.object({
    authToken: v.string(),
    meetingId: v.string(),
    // The call's effective transcription mode (the starter's choice, which a
    // late joiner inherits). Surfaced so the UI can show a "transcribing" pill.
    transcribe: v.boolean(),
  }),
  handler: async (
    ctx,
    { channelId, userName, userImage, transcribe, transcriptionLanguage },
  ) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const rtk = realtimeKitFromEnv();

    const { meetingId, transcribe: effectiveTranscribe } =
      await ensureMeetingForChannel(
        ctx,
        channelId,
        rtk,
        transcribe ?? false,
        transcriptionLanguage,
      );

    // Add this user as a participant. The preset must match the call's mode so
    // a late joiner to a transcribed call also gets captions and feeds the
    // live transcript.
    const { token: authToken } = await rtk.addParticipant(meetingId, {
      name: userName,
      picture: userImage,
      presetName: effectiveTranscribe ? PRESET_TRANSCRIBE : PRESET_NO_TRANSCRIBE,
      customParticipantId: userId,
    });

    return { authToken, meetingId, transcribe: effectiveTranscribe };
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
