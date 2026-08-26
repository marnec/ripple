import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { dmLabelFull } from "./lib/dmLabel";
import { action, internalQuery, type ActionCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { transcriptHintValidator } from "./transcriptFormat";
import { scheduleTranscriptIngest } from "./transcriptPool";
import { requireChannelAccess, requireUser } from "./authHelpers";
import {
  realtimeKitFromEnv,
  type RealtimeKitClient,
} from "./lib/realtimeKit";

/**
 * Is the meeting behind an `active` session row still a real, occupied call?
 *
 * **Fails open.** Only a definitive Cloudflare answer of "no session" or "zero
 * participants" retires a row; anything we could not ask (an outage, a rate
 * limit, a timeout) is treated as live. The asymmetry is deliberate: wrongly
 * keeping a dead row costs one call the transcription mode it asked for, while
 * wrongly retiring a live one mints a second meeting for a call already in
 * progress and splits the participants into two rooms that cannot see each
 * other. Only one of those is recoverable by hanging up and rejoining.
 */
async function isMeetingLive(
  rtk: RealtimeKitClient,
  meetingId: string,
): Promise<boolean> {
  try {
    const liveParticipants = await rtk.getLiveParticipants(meetingId);
    return liveParticipants !== null && liveParticipants > 0;
  } catch (e) {
    console.error("RealtimeKit liveness check failed; assuming live:", e);
    return true;
  }
}

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

  // A session row saying `active` is a claim, not a fact. `endSession` is the
  // only thing that clears it and it runs only when the last participant
  // leaves *cleanly* — a closed tab, a crashed browser, two people leaving at
  // the same moment, or a guest (who has no leave path at all) each strand the
  // row with nobody in the meeting. Reusing a stranded row is what pinned a
  // channel's transcription mode to whatever its first-ever call chose, and
  // fed every later call's transcript into the first call's document. So ask
  // Cloudflare, which knows.
  if (session && (await isMeetingLive(rtk, session.cloudflareMeetingId))) {
    // A live call: its transcription mode was fixed when the first joiner
    // created the meeting, and a late joiner can't flip it.
    return {
      meetingId: session.cloudflareMeetingId,
      transcribe: session.transcribe ?? false,
    };
  }

  if (session) {
    // Dead, definitively. Retire the row *by id* — never by channel — so we
    // cannot clobber a fresh session a concurrent caller has already put in
    // its place, then fall through and start a real call.
    await ctx.runMutation(internal.callSessions.deactivateSession, {
      sessionId: session._id,
    });
  }

  let ourMeetingId: string;
  try {
    ({ id: ourMeetingId } = await rtk.createMeeting({
      title: `Channel call ${channelId}`,
      transcribeOnEnd: transcribe,
      transcriptionLanguage,
    }));
  } catch (e) {
    console.error("Cloudflare create-meeting failed:", e);
    // ConvexError: this sentence was written for the user, and a plain throw
    // reaches them as "Server Error" in production.
    throw new ConvexError("Could not start the call");
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

const callSessionFields = {
  _id: v.id("callSessions"),
  _creationTime: v.number(),
  channelId: v.id("channels"),
  cloudflareMeetingId: v.string(),
  active: v.boolean(),
  transcribe: v.optional(v.boolean()),
  cloudflareSessionId: v.optional(v.string()),
  transcriptDocumentId: v.optional(v.id("documents")),
};

const callSessionValidator = v.object(callSessionFields);

/**
 * The channel rule, reachable from an action.
 *
 * `joinCall` is an action, so it cannot call `requireChannelAccess` directly —
 * and for a long time it called nothing at all, checking only that the caller
 * was signed in. That let any authenticated account join any DM or closed
 * channel call, and (worse) *create* the Cloudflare meeting for a channel it
 * could not read. It was trivially exploitable rather than theoretical because
 * `channels.list` handed every workspace member the ids of all closed channels
 * and DMs; that query gated on workspace membership alone, had no callers, and
 * has since been deleted.
 *
 * Mirrors the shape `calendarEvents.joinEventCall` already uses.
 */
export const assertChannelAccess = internalQuery({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    await requireChannelAccess(ctx, channelId);
    return null;
  },
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
    // `requireUser` alone let any signed-in account terminate any call: the
    // rows are patched inactive while the Cloudflare meeting keeps running,
    // so the next joiner mints a second meeting and the original participants
    // are stranded in the orphan.
    await requireChannelAccess(ctx, channelId);

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
 * Retire one session row, addressed by id.
 *
 * Distinct from `endSession`, which retires every active row for a *channel*.
 * The liveness path must not use that: between reading a dead session and
 * retiring it, a concurrent joiner may already have created the channel's next
 * one, and a channel-wide sweep would kill that live call instead. Patching the
 * exact row we judged dead cannot.
 *
 * Internal, and no access check: the only caller is `ensureMeetingForChannel`,
 * which authorizes before it reaches here (`joinCall`) or is gated by an active
 * share (`getGuestCallToken`).
 */
export const deactivateSession = internalMutation({
  args: { sessionId: v.id("callSessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    // Already retired by whoever raced us here — nothing to do.
    if (!session?.active) return null;
    await ctx.db.patch(sessionId, { active: false });
    return null;
  },
});

/**
 * How long an `active` session may go unclosed before the sweep presumes it
 * abandoned. Generously beyond any real call: retiring a row mid-call would
 * send the next joiner into a second meeting, splitting the room. The join-time
 * liveness check is what makes a *short* window unnecessary — by the time this
 * runs, any row it finds has already been read past by every joiner.
 */
const CALL_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const EXPIRY_SWEEP_LIMIT = 100;

/**
 * Close out `active` session rows that nothing else will.
 *
 * The backstop, not the fix — `ensureMeetingForChannel` reads past a stale row
 * on the next join, the same way `taskImports`' readers read past an abandoned
 * import job rather than waiting on its cron. This exists because that check is
 * edge-triggered: a channel nobody calls again keeps its stranded row forever,
 * and the rows are what `by_channel_active` has to scan.
 */
export const expireStaleCallSessions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - CALL_SESSION_MAX_AGE_MS;

    const stale = await ctx.db
      .query("callSessions")
      .withIndex("by_active", (q) =>
        q.eq("active", true).lt("_creationTime", cutoff),
      )
      .take(EXPIRY_SWEEP_LIMIT);

    for (const session of stale) {
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
    if (!userId) throw new ConvexError("Not authenticated");

    // Authorize BEFORE touching Cloudflare — `ensureMeetingForChannel` creates
    // the meeting when none is active, so an unauthorized caller must not get
    // that far.
    await ctx.runQuery(internal.callSessions.assertChannelAccess, { channelId });

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
 * Hand a downloaded transcript to the retried ingestion pool.
 *
 * The webhook route is an http action and cannot enqueue on its own, so this is
 * the mutation it runs to do it. It stays deliberately dumb — every guard
 * (session gone, document already attached, unparseable bytes) belongs to the
 * ingestion itself, which has to re-check them on each attempt anyway.
 */
export const enqueueTranscriptIngest = internalMutation({
  args: {
    cloudflareMeetingId: v.string(),
    cloudflareSessionId: v.optional(v.string()),
    storageId: v.id("_storage"),
    formatHint: v.optional(transcriptHintValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await scheduleTranscriptIngest(
      ctx,
      internal.transcripts.ingestTranscript,
      { kind: "transcripts:ingestTranscript", key: args.cloudflareMeetingId },
      args,
    );
    return null;
  },
});

/**
 * Look up a call session by its Cloudflare meeting id. Used by the transcript
 * webhook ingest to resolve a `meeting.transcript` delivery back to its channel
 * and workspace. The row persists after the call ends (`active: false`), so
 * this resolves even though the call is over by the time the webhook fires.
 *
 * `transcriptDocumentNeedsSnapshot` is the ingest's real idempotency question,
 * answered here in the same read as the session so the two cannot disagree.
 * Attaching the document and saving its snapshot are two writes, and an attempt
 * that gives up between them leaves a session pointing at an *empty* document —
 * which a plain "is a document attached" guard reads as work already done,
 * retiring every later attempt and leaving the call's transcript blank forever.
 */
export const getSessionByMeeting = internalQuery({
  args: { cloudflareMeetingId: v.string() },
  returns: v.union(
    v.object({
      ...callSessionFields,
      transcriptDocumentNeedsSnapshot: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { cloudflareMeetingId }) => {
    const session = await ctx.db
      .query("callSessions")
      .withIndex("by_meeting", (q) =>
        q.eq("cloudflareMeetingId", cloudflareMeetingId),
      )
      .first();
    if (!session) return null;

    // A missing document cannot be "needing a snapshot": the documents
    // delete-trigger clears this FK, so the pair is only transiently out of
    // step and re-creating from scratch is the right answer there.
    const attached = session.transcriptDocumentId
      ? await ctx.db.get(session.transcriptDocumentId)
      : null;
    return {
      ...session,
      transcriptDocumentNeedsSnapshot:
        attached !== null && attached.yjsSnapshotId === undefined,
    };
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
    // A DM stores no label — derive it. This query takes no viewer, so it is
    // the participant-independent form.
    const name =
      channel.type === "dm" ? await dmLabelFull(ctx, channel._id) : channel.name;
    return { name, workspaceId: channel.workspaceId };
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
