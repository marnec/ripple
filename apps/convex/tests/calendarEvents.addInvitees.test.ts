import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { deliveredPushes, resetDeliveredPushes } from "./pushProbe";

type TestContext = ReturnType<typeof createTestContext>;

/**
 * Calendar email is no longer a scheduled action with a greppable name — it is
 * enqueued into `emailPool` (see `convex/emailPool.ts`), because a scheduled
 * action runs at most once and these messages need retries. So the observable
 * moved from a `_scheduled_functions` row to the send itself: drain the queue,
 * count what reached Resend. The assertions below are unchanged in meaning.
 */
const sendEmail = vi.fn();

vi.mock("../convex/utils/sendPushToUsers", async () => {
  const probe = await import("./pushProbe");
  return probe.pushDeliveryMock();
});

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (payload: unknown, options?: unknown) => sendEmail(payload, options) };
  },
}));

/** Drain the pool and report how many calendar emails have actually been sent. */
async function countCalendarEmails(t: TestContext): Promise<number> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return sendEmail.mock.calls.length;
}

/** Likewise for in-app push, which now drains through `notificationPool`. */
async function countDeliveredPushes(t: TestContext): Promise<number> {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return deliveredPushes.length;
}


const ONE_HOUR = 60 * 60 * 1000;

async function addMember(
  t: TestContext,
  workspaceId: string,
  userId: string,
  role: "admin" | "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId: workspaceId as any,
      userId: userId as any,
      role,
    });
  });
}

async function countScheduled(t: TestContext, predicate: (name: string) => boolean) {
  const rows = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.filter((r: any) => predicate(String(r.name ?? ""))).length;
}

describe("calendarEvents.addInvitees", () => {
  let t: TestContext;
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeliveredPushes();
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ data: { id: "resend-1" }, error: null });
    process.env.AUTH_RESEND_KEY = "re_test_key";
    process.env.RESEND_TEST_MODE = "false";
    t = createTestContext();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a workspace member: row created, no share row, member email scheduled", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const { userId: memberId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
    });
    await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

    const beforeInvite = await countCalendarEmails(t);
    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [memberId as any],
      guestEmails: [],
    });
    const afterInvite = await countCalendarEmails(t);

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
    const row = detail.invitees[0];
    expect(row?.userId).toBe(memberId);
    expect(row?.shareId).toBeUndefined();
    expect(row?.status).toBe("pending");
    // Default email pref is on → exactly one member email scheduled.
    expect(afterInvite - beforeInvite).toBe(1);
  });

  it("adds a guest email: invitee row + share row + guest email scheduled", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const beforeInvite = await countCalendarEmails(t);
    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [],
      guestEmails: ["guest@x.com"],
    });
    const afterInvite = await countCalendarEmails(t);

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
    const row = detail.invitees[0];
    expect(row?.guestEmail).toBe("guest@x.com");
    expect(row?.shareId).toBeTruthy();

    const shares = await t.run(async (ctx) =>
      ctx.db
        .query("resourceShares")
        .withIndex("by_resource_id", (q) => q.eq("resourceId", eventId))
        .collect(),
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]?.shareId).toBe(row?.shareId);

    expect(afterInvite - beforeInvite).toBe(1);
  });

  it("dedupes existing member invitees: re-add is a no-op", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      email: "bob@test.com",
    });
    await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [memberId as any], guestEmails: [] },
    });

    const beforeInvite = await countCalendarEmails(t);
    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [memberId as any],
      guestEmails: [],
    });
    const afterInvite = await countCalendarEmails(t);

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
    // No new email scheduled — dedup short-circuits before the loop.
    expect(afterInvite).toBe(beforeInvite);
  });

  it("dedupes existing guest emails (case-insensitive)", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: ["existing@x.com"] },
    });

    const beforeInvite = await countCalendarEmails(t);
    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [],
      // Different casing — should normalise + skip.
      guestEmails: ["EXISTING@X.com"],
    });
    const afterInvite = await countCalendarEmails(t);

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
    expect(afterInvite).toBe(beforeInvite);
  });

  it("rejects when caller is not the organizer", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const { userId: otherId, asUser: asOther } = await setupAuthenticatedUser(t, {
      email: "other@test.com",
    });
    await addMember(t, workspaceId, otherId, WorkspaceRole.MEMBER);

    await expect(
      asOther.mutation(api.calendarEvents.addInvitees, {
        eventId,
        userIds: [],
        guestEmails: ["new@x.com"],
      }),
    ).rejects.toThrow();
  });

  it("rejects when event has been cancelled", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });
    await asUser.mutation(api.calendarEvents.cancel, { eventId });

    await expect(
      asUser.mutation(api.calendarEvents.addInvitees, {
        eventId,
        userIds: [],
        guestEmails: ["late@x.com"],
      }),
    ).rejects.toThrow();
  });

  it("rejects when adding a non-workspace user", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: outsiderId } = await setupAuthenticatedUser(t, {
      email: "outsider@test.com",
    });
    // Note: NOT added as a workspace member.

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    await expect(
      asUser.mutation(api.calendarEvents.addInvitees, {
        eventId,
        userIds: [outsiderId as any],
        guestEmails: [],
      }),
    ).rejects.toThrow();
  });

  it("schedules notifications for new members (not pre-existing ones)", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: alreadyId } = await setupAuthenticatedUser(t, {
      email: "already@test.com",
    });
    await addMember(t, workspaceId, alreadyId, WorkspaceRole.MEMBER);

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [alreadyId as any], guestEmails: [] },
    });

    const { userId: newId } = await setupAuthenticatedUser(t, {
      email: "new@test.com",
    });
    await addMember(t, workspaceId, newId, WorkspaceRole.MEMBER);

    const beforePush = await countDeliveredPushes(t);
    const beforeInvite = await countCalendarEmails(t);

    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [alreadyId as any, newId as any],
      guestEmails: [],
    });

    const afterPush = await countDeliveredPushes(t);
    const afterInvite = await countCalendarEmails(t);

    // Only the brand-new invitee gets notified — the pre-existing one
    // is dedup'd out before any dispatch.
    expect(afterInvite - beforeInvite).toBe(1);
    expect(afterPush).toBeGreaterThan(beforePush);
  });
});
