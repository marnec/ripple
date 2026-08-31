import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { channelLabel } from "./lib/dmLabel";
import { action, internalQuery, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { transcriptHintValidator } from "./transcriptFormat";
import { scheduleTranscriptIngest } from "./transcriptPool";
import { requireChannelAccess, requireUser } from "./authHelpers";
import { occurrenceOpenAt } from "./lib/seriesOccurrence";
import {
  realtimeKitFromEnv,
  type RealtimeKitClient,
} from "./lib/realtimeKit";

import { isDirectMessage } from "@ripple/shared/channel";
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
 * How long a freshly-created session is presumed live regardless of what
 * Cloudflare says about its participant count.
 *
 * `isMeetingLive` answers "is anyone connected right now", which is not the
 * same question as "is this call real". Minting a token is only the first step
 * of joining: the client then lazy-imports the ~1.5MB RealtimeKit bundle,
 * initialises it, and opens a WebSocket. For that whole window the starter
 * holds a token and is connected to nothing, so their session is
 * indistinguishable from one stranded by a crash — and the next person to press
 * Start retires it and opens a second meeting. Two users, two rooms, one
 * channel; observed with the rows 1.3s apart.
 *
 * 30s is ~20x the observed gap and still bounds the opposite error: a starter
 * who abandons immediately leaves a joinable-but-empty meeting for at most this
 * long. Sitting alone in the room someone just left is a far better failure
 * than being silently split from them.
 */
const SESSION_JOIN_GRACE_MS = 30_000;

/**
 * Whether an active session row should be treated as a real, joinable call.
 *
 * The grace check comes first so the common case — someone joining moments
 * after the call started — skips the Cloudflare round trip entirely.
 */
async function isSessionUsable(
  rtk: RealtimeKitClient,
  session: { cloudflareMeetingId: string; _creationTime: number },
): Promise<boolean> {
  if (Date.now() - session._creationTime < SESSION_JOIN_GRACE_MS) return true;
  return await isMeetingLive(rtk, session.cloudflareMeetingId);
}

/**
 * Where a call happens. A channel has a persistent room and so accumulates
 * successive sessions on one id; a standalone calendar event hosts its own.
 * Every session belongs to exactly one venue.
 */
export type CallVenue =
  | { kind: "channel"; channelId: Id<"channels"> }
  | { kind: "event"; eventId: Id<"calendarEvents"> }
  | { kind: "series"; seriesId: Id<"eventSeries"> };

const callVenueValidator = v.union(
  v.object({ kind: v.literal("channel"), channelId: v.id("channels") }),
  v.object({ kind: v.literal("event"), eventId: v.id("calendarEvents") }),
  v.object({ kind: v.literal("series"), seriesId: v.id("eventSeries") }),
);

/** The venue's own words for a Cloudflare meeting title. */
function venueLabel(venue: CallVenue): string {
  switch (venue.kind) {
    case "channel":
      return `Channel call ${venue.channelId}`;
    case "event":
      return `Event call ${venue.eventId}`;
    case "series":
      return `Series call ${venue.seriesId}`;
  }
}

/** The one column a `callSessions` row files its venue under. */
function venueColumn(venue: CallVenue) {
  switch (venue.kind) {
    case "channel":
      return { channelId: venue.channelId };
    case "event":
      return { eventId: venue.eventId };
    case "series":
      return { seriesId: venue.seriesId };
  }
}

/**
 * Race-safe wrapper that returns the Cloudflare meetingId for a venue.
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
export async function ensureMeetingForVenue(
  ctx: ActionCtx,
  venue: CallVenue,
  rtk: RealtimeKitClient,
  transcribe: boolean,
  // ISO 639-1 code (`en`, `es`, …). Only meaningful when `transcribe` is true
  // and we're creating the meeting (the client documents the `"multi"` trap).
  transcriptionLanguage?: string,
): Promise<{ meetingId: string; transcribe: boolean }> {
  const session = await ctx.runQuery(internal.callSessions.getActiveSession, {
    venue,
  });

  // A session row saying `active` is a claim, not a fact. `endSession` is the
  // only thing that clears it and it runs only when the last participant
  // leaves *cleanly* — a closed tab, a crashed browser, two people leaving at
  // the same moment, or a guest (who has no leave path at all) each strand the
  // row with nobody in the meeting. Reusing a stranded row is what pinned a
  // channel's transcription mode to whatever its first-ever call chose, and
  // fed every later call's transcript into the first call's document. So ask
  // Cloudflare, which knows — but not about a row younger than the join grace,
  // which Cloudflare cannot answer for yet (see `SESSION_JOIN_GRACE_MS`).
  if (session && (await isSessionUsable(rtk, session))) {
    // A live call: its transcription mode was fixed when the first joiner
    // created the meeting. Nothing here lets a late joiner flip it, and that
    // is a product decision rather than a platform limit — Cloudflare will
    // accept `transcribe_on_end` on `PATCH /meetings/{id}` at any time. We
    // don't, because the preset that decides *whose* audio is transcribed
    // binds at join: flipping mid-call would produce a transcript silently
    // missing everyone already in the room.
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
      title: venueLabel(venue),
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
    venue,
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

/**
 * The live meeting for a channel, or null — never creating one.
 *
 * `ensureMeetingForChannel` is the join-*or*-start path. Callers who may only
 * join an existing call use this instead: guests arriving on a public share
 * link, who must not be able to mint a call (nor, therefore, choose its
 * transcription mode) in a workspace they are not members of.
 *
 * Like `ensureMeetingForChannel` it trusts Cloudflare over the `active` flag —
 * subject to the same join grace, so a guest arriving seconds after a member
 * started is not told there is no call — and inherits `isMeetingLive`'s
 * fail-open: an RTK outage reports the call as live, and the subsequent
 * `addParticipant` is what fails.
 */
export async function findLiveMeetingForVenue(
  ctx: ActionCtx,
  venue: CallVenue,
  rtk: RealtimeKitClient,
): Promise<{ meetingId: string; transcribe: boolean } | null> {
  const session = await ctx.runQuery(internal.callSessions.getActiveSession, {
    venue,
  });
  if (!session) return null;
  if (!(await isSessionUsable(rtk, session))) return null;

  return {
    meetingId: session.cloudflareMeetingId,
    transcribe: session.transcribe ?? false,
  };
}

/**
 * The channel forms, kept because a channel call is by far the common one and
 * every existing caller says "channel" rather than "venue".
 */
export function ensureMeetingForChannel(
  ctx: ActionCtx,
  channelId: Id<"channels">,
  rtk: RealtimeKitClient,
  transcribe: boolean,
  transcriptionLanguage?: string,
): Promise<{ meetingId: string; transcribe: boolean }> {
  return ensureMeetingForVenue(
    ctx,
    { kind: "channel", channelId },
    rtk,
    transcribe,
    transcriptionLanguage,
  );
}

export function findLiveMeetingForChannel(
  ctx: ActionCtx,
  channelId: Id<"channels">,
  rtk: RealtimeKitClient,
): Promise<{ meetingId: string; transcribe: boolean } | null> {
  return findLiveMeetingForVenue(ctx, { kind: "channel", channelId }, rtk);
}

const callSessionFields = {
  _id: v.id("callSessions"),
  _creationTime: v.number(),
  channelId: v.optional(v.id("channels")),
  eventId: v.optional(v.id("calendarEvents")),
  seriesId: v.optional(v.id("eventSeries")),
  cloudflareMeetingId: v.string(),
  active: v.boolean(),
  transcribe: v.optional(v.boolean()),
  cloudflareSessionId: v.optional(v.string()),
  transcriptDocumentId: v.optional(v.id("documents")),
  occurrenceStartMs: v.optional(v.number()),
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

/** The active session for a venue, whichever kind of venue it is. */
async function activeSessionFor(ctx: QueryCtx, venue: CallVenue) {
  switch (venue.kind) {
    case "channel":
      return await ctx.db
        .query("callSessions")
        .withIndex("by_channel_active", (q) =>
          q.eq("channelId", venue.channelId).eq("active", true),
        )
        .first();
    case "event":
      return await ctx.db
        .query("callSessions")
        .withIndex("by_event_active", (q) =>
          q.eq("eventId", venue.eventId).eq("active", true),
        )
        .first();
    case "series":
      return await ctx.db
        .query("callSessions")
        .withIndex("by_series_active", (q) =>
          q.eq("seriesId", venue.seriesId).eq("active", true),
        )
        .first();
  }
}

/**
 * The occurrence a call being created right now belongs to, as the fields to
 * spread onto the new row.
 *
 * Only a series has occurrences, and only the clock decides which one: the
 * occurrence whose join window is open. When none is — a caller that reached
 * here outside every window — the row is left unstamped rather than being
 * given the nearest guess, because a call filed under the wrong Tuesday is
 * worse than one filed under none.
 */
async function occurrenceStamp(
  ctx: QueryCtx,
  venue: CallVenue,
): Promise<{ occurrenceStartMs?: number }> {
  if (venue.kind !== "series") return {};
  const series = await ctx.db.get(venue.seriesId);
  if (!series) return {};
  const occurrence = occurrenceOpenAt(series, Date.now());
  return occurrence ? { occurrenceStartMs: occurrence.originalStartMs } : {};
}

export const getActiveSession = internalQuery({
  args: { venue: callVenueValidator },
  returns: v.union(callSessionValidator, v.null()),
  handler: async (ctx, { venue }) => await activeSessionFor(ctx, venue),
});

export const createSession = internalMutation({
  args: {
    venue: callVenueValidator,
    cloudflareMeetingId: v.string(),
    transcribe: v.boolean(),
  },
  // null = we won the race (our meeting is now the active session). An object
  // = we lost; the returned row is the winner whose transcription mode applies.
  returns: v.union(
    v.null(),
    v.object({ cloudflareMeetingId: v.string(), transcribe: v.boolean() }),
  ),
  handler: async (ctx, { venue, cloudflareMeetingId, transcribe }) => {
    // Check inside the mutation (transactional) to prevent duplicate sessions
    const existing = await activeSessionFor(ctx, venue);

    if (existing) {
      return {
        cloudflareMeetingId: existing.cloudflareMeetingId,
        transcribe: existing.transcribe ?? false,
      };
    }

    await ctx.db.insert("callSessions", {
      ...venueColumn(venue),
      cloudflareMeetingId,
      active: true,
      transcribe,
      // Decided here — once, at creation — and never revisited. A call that
      // started three minutes early belongs to the occurrence about to begin,
      // and one that runs twenty minutes long keeps the occurrence it opened
      // in rather than being re-adjudicated as it goes.
      ...(await occurrenceStamp(ctx, venue)),
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
export const PRESET_TRANSCRIBE = "group_call_host";
export const PRESET_NO_TRANSCRIBE = "group_call_host_notranscript";

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
 * What the transcript ingest needs to name and file a call's document: the
 * venue's own name, its workspace, and the channel to link the document to
 * when there is one. No auth — invoked from the webhook action, which has
 * already resolved the session by meeting id.
 *
 * Takes the session rather than the venue, because the webhook holds a session
 * and only this query knows which venue kind the row carries.
 */
export const getVenueForTranscript = internalQuery({
  args: { sessionId: v.id("callSessions") },
  returns: v.union(
    v.object({
      name: v.string(),
      workspaceId: v.id("workspaces"),
      channelId: v.union(v.id("channels"), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;

    if (session.channelId) {
      const channel = await ctx.db.get(session.channelId);
      if (!channel) return null;
      // No viewer here, so the participant-independent form.
      return {
        name: await channelLabel(ctx, channel),
        workspaceId: channel.workspaceId,
        channelId: session.channelId,
      };
    }

    if (session.eventId) {
      const event = await ctx.db.get(session.eventId);
      if (!event) return null;
      return { name: event.title, workspaceId: event.workspaceId, channelId: null };
    }

    if (session.seriesId) {
      const series = await ctx.db.get(session.seriesId);
      if (!series) return null;
      // The series' own name, not the occurrence's date: each occurrence's
      // call already has its own session and therefore its own document, and
      // the ingest stamps the name with when the call happened.
      return { name: series.title, workspaceId: series.workspaceId, channelId: null };
    }

    return null;
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
