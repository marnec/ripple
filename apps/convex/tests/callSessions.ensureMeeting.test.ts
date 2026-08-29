import { describe, it, expect, vi } from "vitest";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  ensureMeetingForChannel,
  findLiveMeetingForChannel,
} from "../convex/callSessions";
import { internal } from "../convex/_generated/api";
import type {
  RealtimeKitClient,
  CreateMeetingOptions,
} from "../convex/lib/realtimeKit";
import { createTestContext, setupWorkspaceWithAdmin, channelFields } from "./helpers";

type T = ReturnType<typeof createTestContext>;

/**
 * `ensureMeetingForChannel` is the race-safe meeting creator. It was previously
 * untested because it spoke raw `fetch` to Cloudflare; now it takes a
 * `RealtimeKitClient`, so we can drive its orchestration with a fake client and
 * the real `createSession` mutation against a test database — no network, no
 * env vars.
 *
 * The function uses `ctx.runQuery`/`ctx.runMutation`, which `t.run`'s ctx does
 * not provide, so we hand it a minimal action-ctx shim that delegates to the
 * test harness's `t.query`/`t.mutation` (these run the real registered internal
 * functions).
 */
function actionCtx(t: T): ActionCtx {
  return {
    runQuery: (ref: unknown, args: unknown) =>
      (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
    runMutation: (ref: unknown, args: unknown) =>
      (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
  } as unknown as ActionCtx;
}

async function makeChannel(t: T): Promise<Id<"channels">> {
  const { workspaceId } = await setupWorkspaceWithAdmin(t);
  return t.run((ctx) =>
    ctx.db.insert("channels", {
      name: "general",
      workspaceId,
      ...channelFields("open"),
    }),
  );
}

/**
 * Run `fn` with the clock advanced past `SESSION_JOIN_GRACE_MS`.
 *
 * A row seeded by a test is created "now", and a session younger than the join
 * grace is presumed live without asking Cloudflare — so every stranded-row case
 * has to age its row first, exactly as a real one would have.
 */
async function afterJoinGrace<R>(fn: () => Promise<R>): Promise<R> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 60_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

function countActiveSessions(t: T, channelId: Id<"channels">): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("callSessions")
      .withIndex("by_channel_active", (q) =>
        q.eq("channelId", channelId).eq("active", true),
      )
      .collect();
    return rows.length;
  });
}

describe("ensureMeetingForChannel", () => {
  it("creates and persists a meeting when none is active (winner path)", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "our-meeting" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => null),
      deleteMeeting: vi.fn(async () => {}),
    };

    const result = await ensureMeetingForChannel(
      actionCtx(t),
      channelId,
      rtk,
      true,
      "it",
    );

    expect(result).toEqual({ meetingId: "our-meeting", transcribe: true });
    // We won the race — nothing to clean up.
    expect(rtk.deleteMeeting).not.toHaveBeenCalled();
    // The starter's transcription choice is baked into createMeeting.
    expect(rtk.createMeeting).toHaveBeenCalledWith({
      title: `Channel call ${channelId}`,
      transcribeOnEnd: true,
      transcriptionLanguage: "it",
    } satisfies CreateMeetingOptions);
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("reuses an active call's meeting and mode without creating one", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "existing-meeting",
        active: true,
        transcribe: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "should-not-be-used" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      // The call is genuinely in progress.
      getLiveParticipants: vi.fn(async () => 2),
      deleteMeeting: vi.fn(async () => {}),
    };

    // A late joiner asks for no transcription, but inherits the active call's
    // mode (it can't flip it).
    const result = await ensureMeetingForChannel(
      actionCtx(t),
      channelId,
      rtk,
      false,
    );

    expect(result).toEqual({ meetingId: "existing-meeting", transcribe: true });
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("deletes its orphan meeting and yields to the winner on a lost race", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);

    // Simulate a concurrent caller winning the race during our CF round-trip:
    // a session lands in the window between our `getActiveSession` (null) and
    // our `createSession`. The fake client inserts it as a side effect of
    // createMeeting.
    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async (_opts: CreateMeetingOptions) => {
        await t.run((ctx) =>
          ctx.db.insert("callSessions", {
            channelId,
            cloudflareMeetingId: "winner-meeting",
            active: true,
            transcribe: true,
          }),
        );
        return { id: "our-meeting" };
      }),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => null),
      deleteMeeting: vi.fn(async () => {}),
    };

    const result = await ensureMeetingForChannel(
      actionCtx(t),
      channelId,
      rtk,
      false,
    );

    // We yield to the winner's meeting and transcription mode...
    expect(result).toEqual({ meetingId: "winner-meeting", transcribe: true });
    // ...and clean up our orphaned meeting so it doesn't burn CF quota.
    expect(rtk.deleteMeeting).toHaveBeenCalledWith("our-meeting");
    // No duplicate session row was created.
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });
});

describe("ensureMeetingForChannel — stranded session rows", () => {
  /**
   * `endSession` only runs on a clean last-participant leave, so a closed tab,
   * a crash, or a guest (who has no leave path) leaves `active: true` behind
   * with nobody in the meeting. Cloudflare is the authority on whether the call
   * is real; these cover what we do with each of its answers.
   */

  async function seedActiveSession(
    t: T,
    channelId: Id<"channels">,
    transcribe: boolean,
  ) {
    return t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "stranded-meeting",
        active: true,
        transcribe,
      }),
    );
  }

  it("starts a fresh call, on the caller's terms, when the row is stranded", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    const strandedId = await seedActiveSession(t, channelId, false);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "new-meeting" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      // Cloudflare: that meeting has no session.
      getLiveParticipants: vi.fn(async () => null),
      deleteMeeting: vi.fn(async () => {}),
    };

    const result = await afterJoinGrace(() =>
      ensureMeetingForChannel(actionCtx(t), channelId, rtk, true, "it"),
    );

    // The whole point: the caller's transcription choice is honoured rather
    // than inherited from a call that ended days ago.
    expect(result).toEqual({ meetingId: "new-meeting", transcribe: true });
    expect(rtk.createMeeting).toHaveBeenCalledWith({
      title: `Channel call ${channelId}`,
      transcribeOnEnd: true,
      transcriptionLanguage: "it",
    } satisfies CreateMeetingOptions);

    const stranded = await t.run((ctx) => ctx.db.get(strandedId));
    expect(stranded?.active).toBe(false);
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("treats a session with zero live participants as stranded", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await seedActiveSession(t, channelId, false);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "new-meeting" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => 0),
      deleteMeeting: vi.fn(async () => {}),
    };

    const result = await afterJoinGrace(() =>
      ensureMeetingForChannel(actionCtx(t), channelId, rtk, false),
    );

    expect(result.meetingId).toBe("new-meeting");
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("reuses a just-created session even though nobody has connected yet", async () => {
    // The regression. Minting a token is not joining: the starter still has to
    // fetch the RealtimeKit bundle, initialise it and open a socket, and for
    // that whole window Cloudflare reports zero participants. Treating that as
    // stranded is what put two users in two meetings in the same channel, with
    // rows 1.3s apart and opposite transcription modes.
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await seedActiveSession(t, channelId, true);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "second-meeting" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      // Cloudflare, truthfully: nobody is connected. The starter is still
      // loading the SDK.
      getLiveParticipants: vi.fn(async () => 0),
      deleteMeeting: vi.fn(async () => {}),
    };

    // The second user presses Start and asks for no transcription.
    const result = await ensureMeetingForChannel(
      actionCtx(t),
      channelId,
      rtk,
      false,
    );

    // They land in the starter's call, on the starter's terms.
    expect(result).toEqual({
      meetingId: "stranded-meeting",
      transcribe: true,
    });
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("fails open: an unreachable Cloudflare keeps the existing call", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await seedActiveSession(t, channelId, true);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "should-not-be-used" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => {
        throw new Error("Cloudflare is having a day");
      }),
      deleteMeeting: vi.fn(async () => {}),
    };

    const result = await ensureMeetingForChannel(
      actionCtx(t),
      channelId,
      rtk,
      false,
    );

    // Splitting a live call across two meetings is the worse failure, so an
    // unanswerable probe must not retire the row.
    expect(result).toEqual({
      meetingId: "stranded-meeting",
      transcribe: true,
    });
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });

  it("retires only the row it judged dead, not the channel's next call", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    const strandedId = await seedActiveSession(t, channelId, false);

    // A concurrent joiner gets there first: it retires the stranded row and
    // opens a real call while we are still talking to Cloudflare. Retiring by
    // channel rather than by id would kill that call.
    let successorId: Id<"callSessions"> | null = null;
    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "our-meeting" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => {
        await t.run(async (ctx) => {
          await ctx.db.patch(strandedId, { active: false });
          successorId = await ctx.db.insert("callSessions", {
            channelId,
            cloudflareMeetingId: "successor-meeting",
            active: true,
            transcribe: true,
          });
        });
        return null;
      }),
      deleteMeeting: vi.fn(async () => {}),
    };

    await afterJoinGrace(() =>
      ensureMeetingForChannel(actionCtx(t), channelId, rtk, false),
    );

    const successor = await t.run((ctx) =>
      ctx.db.get(successorId as unknown as Id<"callSessions">),
    );
    expect(successor?.active).toBe(true);
    expect(await countActiveSessions(t, channelId)).toBe(1);
  });
});

describe("findLiveMeetingForChannel", () => {
  /**
   * The join-only counterpart to `ensureMeetingForChannel`, used by guests on a
   * public share link. The property that matters is negative: it must never
   * create a meeting. A guest who could start a call would also be fixing its
   * transcription mode — the one decision reserved for whoever starts it — in a
   * workspace they are not a member of.
   */

  it("returns null without creating anything when no call exists", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => null),
      deleteMeeting: vi.fn(async () => {}),
    };

    expect(await findLiveMeetingForChannel(actionCtx(t), channelId, rtk)).toBe(
      null,
    );
    expect(rtk.createMeeting).not.toHaveBeenCalled();
    expect(await countActiveSessions(t, channelId)).toBe(0);
  });

  it("returns null without creating anything when the row is stranded", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "stranded-meeting",
        active: true,
        transcribe: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      // Cloudflare: that meeting has nobody in it.
      getLiveParticipants: vi.fn(async () => 0),
      deleteMeeting: vi.fn(async () => {}),
    };

    expect(
      await afterJoinGrace(() =>
        findLiveMeetingForChannel(actionCtx(t), channelId, rtk),
      ),
    ).toBe(null);
    expect(rtk.createMeeting).not.toHaveBeenCalled();
  });

  it("admits a guest to a call whose starter has not connected yet", async () => {
    // Same window as the member-side regression: without the join grace a
    // guest clicking a share link seconds after the call started would be told
    // there is no call in progress.
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "brand-new-meeting",
        active: true,
        transcribe: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => 0),
      deleteMeeting: vi.fn(async () => {}),
    };

    expect(
      await findLiveMeetingForChannel(actionCtx(t), channelId, rtk),
    ).toEqual({ meetingId: "brand-new-meeting", transcribe: true });
    expect(rtk.createMeeting).not.toHaveBeenCalled();
  });

  it("returns the live meeting and the mode it was started with", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "live-meeting",
        active: true,
        transcribe: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => 2),
      deleteMeeting: vi.fn(async () => {}),
    };

    expect(
      await findLiveMeetingForChannel(actionCtx(t), channelId, rtk),
    ).toEqual({ meetingId: "live-meeting", transcribe: true });
    expect(rtk.createMeeting).not.toHaveBeenCalled();
  });

  it("fails open like the join-or-start path when Cloudflare is unreachable", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "live-meeting",
        active: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => {
        throw new Error("Cloudflare is having a day");
      }),
      deleteMeeting: vi.fn(async () => {}),
    };

    // Turning a guest away during an RTK blip is worse than letting the
    // subsequent addParticipant be the thing that fails.
    expect(
      await findLiveMeetingForChannel(actionCtx(t), channelId, rtk),
    ).toEqual({ meetingId: "live-meeting", transcribe: false });
  });

  it("leaves a stranded row for the member path to retire", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);
    const strandedId = await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "stranded-meeting",
        active: true,
      }),
    );

    const rtk: RealtimeKitClient = {
      createMeeting: vi.fn(async () => ({ id: "must-not-exist" })),
      addParticipant: vi.fn(async () => ({ token: "tok" })),
      getLiveParticipants: vi.fn(async () => null),
      deleteMeeting: vi.fn(async () => {}),
    };

    await afterJoinGrace(() =>
      findLiveMeetingForChannel(actionCtx(t), channelId, rtk),
    );

    // Read-only on purpose: the cleanup belongs to `ensureMeetingForChannel`,
    // which runs for an authenticated member and starts the replacement call in
    // the same breath.
    const stranded = await t.run((ctx) => ctx.db.get(strandedId));
    expect(stranded?.active).toBe(true);
  });
});

describe("expireStaleCallSessions", () => {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  it("retires active rows past the age limit and leaves younger ones alone", async () => {
    const t = createTestContext();
    const channelId = await makeChannel(t);

    // `_creationTime` is assigned by the harness, so age the row by moving the
    // clock forward rather than trying to write a past timestamp.
    const oldId = await t.run((ctx) =>
      ctx.db.insert("callSessions", {
        channelId,
        cloudflareMeetingId: "old-meeting",
        active: true,
      }),
    );

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + TWELVE_HOURS + 60_000);

      const freshId = await t.run((ctx) =>
        ctx.db.insert("callSessions", {
          channelId,
          cloudflareMeetingId: "fresh-meeting",
          active: true,
        }),
      );

      await t.mutation(internal.callSessions.expireStaleCallSessions, {});

      expect(await t.run((ctx) => ctx.db.get(oldId))).toMatchObject({
        active: false,
      });
      expect(await t.run((ctx) => ctx.db.get(freshId))).toMatchObject({
        active: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
