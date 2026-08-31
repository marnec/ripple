import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { api, internal } from "../convex/_generated/api";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  ensureMeetingForVenue,
  findLiveMeetingForVenue,
} from "../convex/callSessions";
import type { RealtimeKitClient } from "../convex/lib/realtimeKit";
import {
  channelFields,
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole, WorkspaceRole } from "@ripple/shared/enums/roles";

/**
 * A series is a call **venue**, like a channel and like a standalone event:
 * every occurrence meets in the same room, and each occurrence's call is its
 * own session with its own transcript. See ADR 0002.
 *
 * `joinSeriesCall` reaches Cloudflare RealtimeKit, so this stands in for the
 * network client — the same shape `calendarEvents.membership.access` uses.
 */
const rtkCreateMeeting = vi.fn(() => Promise.resolve({ id: "meeting-1" }));
const rtkAddParticipant = vi.fn(() => Promise.resolve({ token: "tok" }));
const rtkGetLiveParticipants = vi.fn(() => Promise.resolve<number | null>(1));
const rtkDeleteMeeting = vi.fn(() => Promise.resolve());

vi.mock("../convex/lib/realtimeKit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../convex/lib/realtimeKit")>()),
  realtimeKitFromEnv: () => ({
    createMeeting: rtkCreateMeeting,
    addParticipant: rtkAddParticipant,
    getLiveParticipants: rtkGetLiveParticipants,
    deleteMeeting: rtkDeleteMeeting,
  }),
}));

type T = ReturnType<typeof createTestContext>;

/** Tuesday 1 September 2026, 09:00–09:30 Rome (UTC+2 that month). */
const WEEKLY_STANDUP = {
  title: "Standup",
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly" as const,
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "never" as const },
  },
};

/** The first two Tuesdays the rule produces, as instants. */
const FIRST_OCCURRENCE = Date.parse("2026-09-01T07:00:00Z");
const SECOND_OCCURRENCE = Date.parse("2026-09-08T07:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  rtkCreateMeeting.mockImplementation(() => Promise.resolve({ id: "meeting-1" }));
  rtkGetLiveParticipants.mockImplementation(() => Promise.resolve<number | null>(1));
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** The same fake the mocked `realtimeKitFromEnv` hands out. */
function fakeRtk(): RealtimeKitClient {
  return {
    createMeeting: rtkCreateMeeting,
    addParticipant: rtkAddParticipant,
    getLiveParticipants: rtkGetLiveParticipants,
    deleteMeeting: rtkDeleteMeeting,
  };
}

/** Enough of an `ActionCtx` to drive the venue helpers directly. */
function actionCtx(t: T): ActionCtx {
  return {
    runQuery: (ref: unknown, args: unknown) =>
      (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
    runMutation: (ref: unknown, args: unknown) =>
      (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
  } as unknown as ActionCtx;
}

function sessionsForSeries(t: T, seriesId: Id<"eventSeries">) {
  return t.run((ctx) =>
    ctx.db
      .query("callSessions")
      .withIndex("by_series_active", (q) => q.eq("seriesId", seriesId))
      .collect(),
  );
}

async function makeStandup(t: T, extra: { channelId?: Id<"channels"> } = {}) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
  const seriesId = await asUser.mutation(api.eventSeries.create, {
    workspaceId,
    ...WEEKLY_STANDUP,
    ...extra,
  });
  return { workspaceId, userId, asUser, seriesId };
}

describe("joining an occurrence of a series", () => {
  it("starts a call the first time anyone joins", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    const call = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    expect(call.meetingId).toBe("meeting-1");
    const sessions = await sessionsForSeries(t, seriesId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cloudflareMeetingId).toBe("meeting-1");
    expect(sessions[0]?.active).toBe(true);
  });

  it("puts a second joiner in the room the first one opened", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });
    rtkCreateMeeting.mockImplementation(() =>
      Promise.resolve({ id: "a-second-room" }),
    );
    const second = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Grace",
    });

    expect(second.meetingId).toBe("meeting-1");
    expect(await sessionsForSeries(t, seriesId)).toHaveLength(1);
  });

  it("gives next week's call its own session in the same room", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    const first = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    // A week later that call is long over, whatever its row still claims.
    vi.setSystemTime(SECOND_OCCURRENCE);
    rtkGetLiveParticipants.mockImplementation(() => Promise.resolve(0));
    rtkCreateMeeting.mockImplementation(() =>
      Promise.resolve({ id: "meeting-2" }),
    );
    const second = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    expect(first.meetingId).toBe("meeting-1");
    expect(second.meetingId).toBe("meeting-2");

    // Two calls, two sessions — filed under the one venue, so the join link
    // never changed.
    const sessions = await sessionsForSeries(t, seriesId);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.active)).toHaveLength(1);
  });
});

describe("which occurrence a call happened in", () => {
  it("is recorded even when the call starts before the occurrence does", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    // Three minutes early: inside the join window, before the meeting itself.
    vi.setSystemTime(FIRST_OCCURRENCE - 3 * 60 * 1000);
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    const [session] = await sessionsForSeries(t, seriesId);
    expect(session?.occurrenceStartMs).toBe(FIRST_OCCURRENCE);
  });

  it("does not change under a call that runs past the scheduled end", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    // Forty minutes in — the 09:00–09:30 standup is overrunning, and someone
    // arrives late. The call is one call, so it is still the same session and
    // still the same occurrence.
    vi.setSystemTime(FIRST_OCCURRENCE + 40 * 60 * 1000);
    const late = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Grace",
    });

    expect(late.meetingId).toBe("meeting-1");
    const sessions = await sessionsForSeries(t, seriesId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.occurrenceStartMs).toBe(FIRST_OCCURRENCE);
  });

  it("is left unrecorded rather than guessed when the clock is nowhere near one", async () => {
    const t = createTestContext();
    const { seriesId } = await makeStandup(t);

    // Mid-afternoon on the Wednesday: the rule places nothing here, so there
    // is no occurrence this call could honestly be filed under.
    vi.setSystemTime(Date.parse("2026-09-02T14:00:00Z"));
    await ensureMeetingForVenue(
      actionCtx(t),
      { kind: "series", seriesId },
      fakeRtk(),
      false,
    );

    const [session] = await sessionsForSeries(t, seriesId);
    expect(session?.cloudflareMeetingId).toBe("meeting-1");
    expect(session?.occurrenceStartMs).toBeUndefined();
  });
});

describe("a series hosted in a channel", () => {
  it("meets in the channel's room rather than one of its own", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "team",
        workspaceId,
        ...channelFields("open"),
      }),
    );
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      channelId,
    });

    vi.setSystemTime(FIRST_OCCURRENCE);
    const call = await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    // The channel's persistent room, reported as the channel's so the client
    // publishes the presence signal a direct channel join would.
    expect(call.channelId).toBe(channelId);
    expect(await sessionsForSeries(t, seriesId)).toHaveLength(0);
    const channelSessions = await t.run((ctx) =>
      ctx.db
        .query("callSessions")
        .withIndex("by_channel_active", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(channelSessions).toHaveLength(1);
  });

  it("does not let a workspace member into a closed channel's room", async () => {
    const t = createTestContext();
    const { workspaceId, userId: organizerId, asUser } =
      await setupWorkspaceWithAdmin(t);
    const channelId = await t.run((ctx) =>
      ctx.db.insert("channels", {
        name: "leads",
        workspaceId,
        ...channelFields("closed"),
      }),
    );
    // The organizer is in the channel; the colleague is only in the workspace.
    await t.run((ctx) =>
      ctx.db.insert("channelMembers", {
        channelId,
        userId: organizerId,
        workspaceId,
        role: ChannelRole.ADMIN,
      }),
    );
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
      channelId,
    });

    const { userId: colleagueId, asUser: colleague } =
      await setupAuthenticatedUser(t);
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", {
        userId: colleagueId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      }),
    );

    vi.setSystemTime(FIRST_OCCURRENCE);
    await expect(
      colleague.action(api.eventSeries.joinSeriesCall, {
        seriesId,
        userName: "Grace",
      }),
    ).rejects.toThrow(/not found|not invited/);
    expect(rtkCreateMeeting).not.toHaveBeenCalled();
  });
});

describe("a guest of a series", () => {
  /**
   * The join-only path, which is what a share link must be built on: a guest
   * may enter a call in progress but never conjure one, because whoever starts
   * a call also decides whether it is transcribed — a decision that does not
   * belong to someone outside the workspace. Same rule, same seam, as a
   * channel's and a standalone event's guest.
   */
  it("may enter an occurrence's call but never start one", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    const nothing = await findLiveMeetingForVenue(
      actionCtx(t),
      { kind: "series", seriesId },
      fakeRtk(),
    );

    expect(nothing).toBeNull();
    expect(rtkCreateMeeting).not.toHaveBeenCalled();
    expect(await sessionsForSeries(t, seriesId)).toHaveLength(0);

    // A member starts the call; now the guest gets in.
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });
    const joined = await findLiveMeetingForVenue(
      actionCtx(t),
      { kind: "series", seriesId },
      fakeRtk(),
    );

    expect(joined).toEqual({ meetingId: "meeting-1", transcribe: false });
    expect(await sessionsForSeries(t, seriesId)).toHaveLength(1);
  });
});

describe("a series call's transcript", () => {
  it("gives each occurrence's call its own document", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    vi.setSystemTime(SECOND_OCCURRENCE);
    rtkGetLiveParticipants.mockImplementation(() => Promise.resolve(0));
    rtkCreateMeeting.mockImplementation(() =>
      Promise.resolve({ id: "meeting-2" }),
    );
    await asUser.action(api.eventSeries.joinSeriesCall, {
      seriesId,
      userName: "Ada",
    });

    // Cloudflare delivers a transcript for each of the two meetings.
    for (const meeting of ["meeting-1", "meeting-2"]) {
      const storageId = await t.run((ctx) =>
        ctx.storage.store(
          new Blob([
            JSON.stringify([{ name: "Ada", transcript: `notes for ${meeting}` }]),
          ]),
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
    for (const doc of docs) {
      expect(doc.name).toContain("Standup call");
      expect(doc.workspaceId).toBe(workspaceId);
      expect(doc.tags).toContain("transcript");
    }
  });
});

describe("when a series call may be joined", () => {
  it("refuses a join hours before the occurrence opens", async () => {
    const t = createTestContext();
    const { asUser, seriesId } = await makeStandup(t);

    vi.setSystemTime(FIRST_OCCURRENCE - 3 * 60 * 60 * 1000);
    await expect(
      asUser.action(api.eventSeries.joinSeriesCall, {
        seriesId,
        userName: "Ada",
      }),
    ).rejects.toThrow("not open");
    expect(rtkCreateMeeting).not.toHaveBeenCalled();
    expect(await sessionsForSeries(t, seriesId)).toHaveLength(0);
  });

  it("refuses someone who is not a member of the workspace", async () => {
    const t = createTestContext();
    const { seriesId } = await makeStandup(t);
    const { asUser: outsider } = await setupAuthenticatedUser(t);

    vi.setSystemTime(FIRST_OCCURRENCE);
    await expect(
      outsider.action(api.eventSeries.joinSeriesCall, {
        seriesId,
        userName: "Mallory",
      }),
    ).rejects.toThrow(/not found|not invited/);
    expect(rtkCreateMeeting).not.toHaveBeenCalled();
  });
});
