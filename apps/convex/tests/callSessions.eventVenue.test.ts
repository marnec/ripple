import { describe, it, expect, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  ensureMeetingForVenue,
  findLiveMeetingForVenue,
} from "../convex/callSessions";
import { internal } from "../convex/_generated/api";
import type { RealtimeKitClient } from "../convex/lib/realtimeKit";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

type T = ReturnType<typeof createTestContext>;

/**
 * A standalone calendar event hosts its own call rather than borrowing a
 * channel's room. Until call sessions gained a venue, that call had no session
 * row at all — and since the transcript ingest resolves a meeting to a session,
 * a standalone event call produced no transcript, ever.
 */
function actionCtx(t: T): ActionCtx {
  return {
    runQuery: (ref: unknown, args: unknown) =>
      (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
    runMutation: (ref: unknown, args: unknown) =>
      (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
  } as unknown as ActionCtx;
}

async function makeEvent(
  t: T,
): Promise<{ eventId: Id<"calendarEvents">; workspaceId: Id<"workspaces"> }> {
  const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
  const eventId = await t.run((ctx) =>
    ctx.db.insert("calendarEvents", {
      workspaceId,
      title: "Design review",
      startsAt: Date.now(),
      endsAt: Date.now() + 30 * 60 * 1000,
      timezone: "Europe/Rome",
      createdBy: userId,
    }),
  );
  return { eventId, workspaceId };
}

/** A fake that answers every Cloudflare question the same way. */
function fakeRtk(overrides: Partial<RealtimeKitClient> = {}): RealtimeKitClient {
  return {
    createMeeting: vi.fn(async () => ({ id: "new-meeting" })),
    addParticipant: vi.fn(async () => ({ token: "tok" })),
    getLiveParticipants: vi.fn(async () => null),
    deleteMeeting: vi.fn(async () => {}),
    ...overrides,
  };
}

async function afterJoinGrace<R>(fn: () => Promise<R>): Promise<R> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 60_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

function sessionsForEvent(t: T, eventId: Id<"calendarEvents">) {
  return t.run((ctx) =>
    ctx.db
      .query("callSessions")
      .withIndex("by_event_active", (q) => q.eq("eventId", eventId))
      .collect(),
  );
}

describe("a standalone event's call", () => {
  it("gets a session row, so the call has somewhere to hang a transcript", async () => {
    const t = createTestContext();
    const { eventId } = await makeEvent(t);
    const rtk = fakeRtk();

    const result = await ensureMeetingForVenue(
      actionCtx(t),
      { kind: "event", eventId },
      rtk,
      false,
    );

    expect(result).toEqual({ meetingId: "new-meeting", transcribe: false });
    const sessions = await sessionsForEvent(t, eventId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cloudflareMeetingId).toBe("new-meeting");
    expect(sessions[0]?.active).toBe(true);
    expect(sessions[0]?.channelId).toBeUndefined();
  });

  it("reuses the live call rather than minting a second meeting", async () => {
    const t = createTestContext();
    const { eventId, workspaceId } = await makeEvent(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        eventId,
        cloudflareMeetingId: "existing-meeting",
        active: true,
        transcribe: false,
      }),
    );
    void workspaceId;

    const rtk = fakeRtk({ getLiveParticipants: vi.fn(async () => 2) });

    const result = await ensureMeetingForVenue(
      actionCtx(t),
      { kind: "event", eventId },
      rtk,
      false,
    );

    expect(result.meetingId).toBe("existing-meeting");
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await sessionsForEvent(t, eventId)).toHaveLength(1);
  });

  it("gives a second call its own session and its own meeting", async () => {
    // This is what a standalone event could never do while its meeting id
    // lived on the event row: one meeting meant one session by meeting id,
    // and so the second call's transcript was discarded as a duplicate of the
    // first call's.
    const t = createTestContext();
    const { eventId } = await makeEvent(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        eventId,
        cloudflareMeetingId: "first-meeting",
        active: true,
        transcribe: false,
      }),
    );

    // Cloudflare: that meeting is over.
    const rtk = fakeRtk({ createMeeting: vi.fn(async () => ({ id: "second-meeting" })) });

    const result = await afterJoinGrace(() =>
      ensureMeetingForVenue(actionCtx(t), { kind: "event", eventId }, rtk, false),
    );

    expect(result.meetingId).toBe("second-meeting");
    const sessions = await sessionsForEvent(t, eventId);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.active)).toHaveLength(1);
    expect(new Set(sessions.map((s) => s.cloudflareMeetingId)).size).toBe(2);
  });

  it("is kept apart from a channel's call in the same workspace", async () => {
    const t = createTestContext();
    const { eventId, workspaceId } = await makeEvent(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "general",
        workspaceId,
        kind: "channel",
        visibility: "public",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "channel-meeting",
        active: true,
        transcribe: false,
      }),
    );

    const rtk = fakeRtk({
      createMeeting: vi.fn(async () => ({ id: "event-meeting" })),
      getLiveParticipants: vi.fn(async () => 2),
    });

    const result = await ensureMeetingForVenue(
      actionCtx(t),
      { kind: "event", eventId },
      rtk,
      false,
    );

    // The channel's live call is not the event's call.
    expect(result.meetingId).toBe("event-meeting");
    expect(await sessionsForEvent(t, eventId)).toHaveLength(1);
  });

  it("lets a guest join one but never start one", async () => {
    const t = createTestContext();
    const { eventId } = await makeEvent(t);
    const rtk = fakeRtk();

    const nothing = await findLiveMeetingForVenue(
      actionCtx(t),
      { kind: "event", eventId },
      rtk,
    );

    expect(nothing).toBeNull();
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await sessionsForEvent(t, eventId)).toHaveLength(0);

    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        eventId,
        cloudflareMeetingId: "live-meeting",
        active: true,
        transcribe: false,
      }),
    );

    const joined = await findLiveMeetingForVenue(
      actionCtx(t),
      { kind: "event", eventId },
      fakeRtk({ getLiveParticipants: vi.fn(async () => 1) }),
    );
    expect(joined).toEqual({ meetingId: "live-meeting", transcribe: false });
  });
});

describe("resolving a session's venue for the transcript", () => {
  it("names an event call from the event", async () => {
    const t = createTestContext();
    const { eventId, workspaceId } = await makeEvent(t);
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        eventId,
        cloudflareMeetingId: "m",
        active: true,
      }),
    );

    const venue = await t.query(internal.callSessions.getVenueForTranscript, {
      sessionId,
    });

    expect(venue).toEqual({
      name: "Design review",
      workspaceId,
      channelId: null,
    });
  });

  it("still names a channel call from the channel", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "general",
        workspaceId,
        kind: "channel",
        visibility: "public",
      }),
    );
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "m",
        active: true,
      }),
    );

    const venue = await t.query(internal.callSessions.getVenueForTranscript, {
      sessionId,
    });

    expect(venue).toEqual({ name: "general", workspaceId, channelId });
  });
});

describe("a standalone event call's transcript", () => {
  /**
   * The gap this ticket closes end to end: the ingest resolves a meeting to a
   * session, and a standalone event call had no session — so the transcript
   * was dropped with a "no call session for meeting" warning and no document
   * was ever produced.
   */
  it("becomes a document named after the event", async () => {
    const t = createTestContext();
    const { eventId, workspaceId } = await makeEvent(t);
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        eventId,
        cloudflareMeetingId: "event-meet-1",
        active: false,
      }),
    );

    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([
          JSON.stringify([
            { name: "Alice", transcript: "Shall we start?" },
            { name: "Bob", transcript: "Go ahead." },
          ]),
        ]),
      ),
    );
    await t.action(internal.transcripts.ingestTranscript, {
      cloudflareMeetingId: "event-meet-1",
      cloudflareSessionId: "event-sess-1",
      storageId,
      formatHint: "json" as const,
    });

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs).toHaveLength(1);
    expect(docs[0]?.name).toContain("Design review call");
    expect(docs[0]?.tags).toContain("transcript");
    expect(docs[0]?.yjsSnapshotId).toBeDefined();
    expect(docs[0]?.workspaceId).toBe(workspaceId);

    // Linked back to the session, which is what makes a duplicate delivery a
    // no-op rather than a second document.
    const session = await t.run((ctx) => ctx.db.get(sessionId));
    expect(session?.transcriptDocumentId).toBe(docs[0]?._id);

    // A standalone event has no channel, so there is no `transcript_of` edge
    // to write — the document still stands on its own.
    const edges = await t.run((ctx) =>
      ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", docs[0]!._id))
        .collect(),
    );
    expect(edges).toHaveLength(0);
  });

  it("gives each of two calls on the event its own document", async () => {
    const t = createTestContext();
    const { eventId } = await makeEvent(t);
    for (const meeting of ["event-meet-a", "event-meet-b"]) {
      await t.run((ctx) =>
        ctx.db.insert("callSessions", {
          eventId,
          cloudflareMeetingId: meeting,
          active: false,
        }),
      );
      const storageId = await t.run((ctx) =>
        ctx.storage.store(
          new Blob([JSON.stringify([{ name: "Alice", transcript: meeting }])]),
        ),
      );
      await t.action(internal.transcripts.ingestTranscript, {
        cloudflareMeetingId: meeting,
        storageId,
        formatHint: "json" as const,
      });
    }

    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs).toHaveLength(2);
  });
});
