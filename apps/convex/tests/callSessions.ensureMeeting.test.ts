import { describe, it, expect, vi } from "vitest";
import { ChannelType } from "@ripple/shared/enums/roles";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import { ensureMeetingForChannel } from "../convex/callSessions";
import type {
  RealtimeKitClient,
  CreateMeetingOptions,
} from "../convex/lib/realtimeKit";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";

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
      type: ChannelType.OPEN,
    }),
  );
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
