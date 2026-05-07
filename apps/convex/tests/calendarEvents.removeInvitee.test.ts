import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type TestContext = ReturnType<typeof createTestContext>;

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

describe("calendarEvents.removeInvitee", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  it("removes a member invitee", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
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

    const before = await asUser.query(api.calendarEvents.get, { eventId });
    expect(before.invitees).toHaveLength(1);
    const inviteeId = before.invitees[0]!._id;

    await asUser.mutation(api.calendarEvents.removeInvitee, { inviteeId });

    const after = await asUser.query(api.calendarEvents.get, { eventId });
    expect(after.invitees).toHaveLength(0);
  });

  it("removing a guest invitee revokes the share row", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: ["guest@x.com"] },
    });

    const before = await asUser.query(api.calendarEvents.get, { eventId });
    const guestRow = before.invitees.find((i) => i.guestEmail === "guest@x.com");
    expect(guestRow?.shareId).toBeTruthy();
    const shareId = guestRow!.shareId!;

    await asUser.mutation(api.calendarEvents.removeInvitee, {
      inviteeId: guestRow!._id,
    });

    const after = await asUser.query(api.calendarEvents.get, { eventId });
    expect(after.invitees).toHaveLength(0);

    // Share row is preserved but marked revoked.
    const shares = await t.run(async (ctx) =>
      ctx.db
        .query("resourceShares")
        .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
        .collect(),
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]?.revokedAt).toBeTypeOf("number");
  });

  it("rejects when caller is not the organizer", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
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
    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    const inviteeId = detail.invitees[0]!._id;

    const { userId: otherId, asUser: asOther } = await setupAuthenticatedUser(t, {
      email: "other@test.com",
    });
    await addMember(t, workspaceId, otherId, WorkspaceRole.MEMBER);

    await expect(
      asOther.mutation(api.calendarEvents.removeInvitee, { inviteeId }),
    ).rejects.toThrow();
  });

  it("is idempotent: removing an already-deleted invitee resolves to null", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: memberId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
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
    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    const inviteeId = detail.invitees[0]!._id;

    await asUser.mutation(api.calendarEvents.removeInvitee, { inviteeId });
    // Second call with the now-stale id is a silent no-op (handler returns null
    // when the row is gone).
    await expect(
      asUser.mutation(api.calendarEvents.removeInvitee, { inviteeId }),
    ).resolves.toBeNull();
  });
});
