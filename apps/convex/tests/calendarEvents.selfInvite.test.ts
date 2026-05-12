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

async function countScheduled(t: TestContext, predicate: (name: string) => boolean) {
  const rows = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.filter((r: any) => predicate(String(r.name ?? ""))).length;
}

describe("calendarEvents.selfInvite", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  it("organiser self-invites: row inserted with status=accepted and respondedAt set", async () => {
    const { userId: organiserId, workspaceId, asUser } =
      await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Solo focus block",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
    const row = detail.invitees[0];
    expect(row?.userId).toBe(organiserId);
    expect(row?.status).toBe("accepted");
    expect(row?.respondedAt).toBeTypeOf("number");
    // Self-invite shouldn't allocate a guest share.
    expect(row?.shareId).toBeUndefined();
  });

  it("does NOT schedule an invite email", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Quiet meeting",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const before = await countScheduled(t, (n) => n.includes("sendEventInvite"));
    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });
    const after = await countScheduled(t, (n) => n.includes("sendEventInvite"));

    // The whole point of this mutation: silence. No invite email, no
    // reschedule notification, no in-app notify() ping.
    expect(after - before).toBe(0);
  });

  it("is idempotent: calling twice yields a single invitee row", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });
    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(1);
  });

  it("non-organiser cannot self-invite (throws)", async () => {
    const { workspaceId, asUser: organiser } = await setupWorkspaceWithAdmin(t);
    const eventId = await organiser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    // Second workspace member tries to gate-crash via selfInvite. The
    // mutation is organiser-only — non-organisers must go through the
    // standard invite flow instead.
    const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(
      t,
      { email: "bob@test.com" },
    );
    await addMember(t, workspaceId, memberId, WorkspaceRole.MEMBER);

    await expect(
      asMember.mutation(api.calendarEvents.selfInvite, { eventId }),
    ).rejects.toThrow();
  });

  it("preserves existing invitees (organiser self-invite adds, doesn't replace)", async () => {
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

    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });

    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    expect(detail.invitees).toHaveLength(2);
    const statuses = detail.invitees.map((i) => i.status).sort();
    // Pre-existing member is "pending", organiser self-invite is "accepted".
    expect(statuses).toEqual(["accepted", "pending"]);
  });
});
