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

describe("calendarEvents.listMineInRange", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  it("returns events the caller created", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const start = Date.now() + ONE_HOUR;
    const end = start + ONE_HOUR;
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Mine",
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: start - ONE_HOUR,
      rangeEndMs: end + ONE_HOUR,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(eventId);
  });

  it("returns events the caller is invited to", async () => {
    const { workspaceId, asUser: asOrganizer } = await setupWorkspaceWithAdmin(t);
    const { userId: inviteeId, asUser: asInvitee } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
    });
    await addMember(t, workspaceId, inviteeId, WorkspaceRole.MEMBER);

    const start = Date.now() + ONE_HOUR;
    const end = start + ONE_HOUR;
    const eventId = await asOrganizer.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Invited",
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
      invitees: { userIds: [inviteeId as any], guestEmails: [] },
    });

    const result = await asInvitee.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: start - ONE_HOUR,
      rangeEndMs: end + ONE_HOUR,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(eventId);
  });

  it("returns each event once even when caller is both organizer and invitee", async () => {
    // The organizer is implicitly an invitee (their own row in calendarEventInvitees);
    // the dedup-by-_id pass in listMineInRange must collapse both scans.
    const { workspaceId, asUser, userId: organiserId } =
      await setupWorkspaceWithAdmin(t);

    // Add an explicit self-invitee row (mirrors what create does for the organizer).
    const start = Date.now() + ONE_HOUR;
    const end = start + ONE_HOUR;
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Solo",
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("calendarEventInvitees", {
        eventId: eventId as any,
        workspaceId: workspaceId as any,
        userId: organiserId as any,
        status: "accepted",
      });
    });

    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: start - ONE_HOUR,
      rangeEndMs: end + ONE_HOUR,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(eventId);
  });

  it("excludes events outside the [rangeStart, rangeEnd) window", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const anchor = Date.now() + 24 * ONE_HOUR;

    // Event 1: starts inside window — included.
    const insideId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Inside",
      startsAt: anchor + ONE_HOUR,
      endsAt: anchor + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    // Event 2: ends exactly at rangeStart — excluded (strict endsAt > rangeStart).
    await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Touches start",
      startsAt: anchor - 2 * ONE_HOUR,
      endsAt: anchor,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    // Event 3: starts at rangeEnd — excluded (strict startsAt < rangeEnd).
    await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Touches end",
      startsAt: anchor + 4 * ONE_HOUR,
      endsAt: anchor + 5 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    // Event 4: spans the window — included (started before, ends after).
    const spanningId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Spanning",
      startsAt: anchor - ONE_HOUR,
      endsAt: anchor + 5 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: anchor,
      rangeEndMs: anchor + 4 * ONE_HOUR,
    });

    const ids = result.map((e) => e._id).sort();
    expect(ids).toEqual([insideId, spanningId].sort());
  });

  it("isolates events across workspaces", async () => {
    const { workspaceId: ws1, asUser, userId } =
      await setupWorkspaceWithAdmin(t, "Workspace 1");

    // Same user owns a second workspace; create a second event there.
    const ws2 = await t.run(async (ctx) => {
      const id = await ctx.db.insert("workspaces", {
        name: "Workspace 2",
        ownerId: userId as any,
      });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: id,
        userId: userId as any,
        role: WorkspaceRole.ADMIN,
      });
      return id;
    });

    const start = Date.now() + ONE_HOUR;
    const end = start + ONE_HOUR;
    const ws1EventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: ws1 as any,
      title: "WS1 event",
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });
    await asUser.mutation(api.calendarEvents.create, {
      workspaceId: ws2 as any,
      title: "WS2 event",
      startsAt: start,
      endsAt: end,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: ws1 as any,
      rangeStartMs: start - ONE_HOUR,
      rangeEndMs: end + ONE_HOUR,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?._id).toBe(ws1EventId);
  });

  it("returns empty for an inverted range", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: Date.now() + ONE_HOUR,
      rangeEndMs: Date.now(),
    });
    expect(result).toEqual([]);
  });

  it("annotates each event with nonOrganizerInviteeCount", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
    });
    await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);
    const { userId: bobId } = await setupAuthenticatedUser(t, {
      email: "bob@test.com",
    });
    await addMember(t, workspaceId, bobId, WorkspaceRole.MEMBER);

    const start = Date.now() + ONE_HOUR;
    await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "With invitees",
      startsAt: start,
      endsAt: start + ONE_HOUR,
      timezone: "UTC",
      invitees: {
        userIds: [aliceId as any, bobId as any],
        guestEmails: ["guest@x.com"],
      },
    });

    const result = await asUser.query(api.calendarEvents.listMineInRange, {
      workspaceId: workspaceId as any,
      rangeStartMs: start - ONE_HOUR,
      rangeEndMs: start + 2 * ONE_HOUR,
    });
    expect(result).toHaveLength(1);
    // 2 members + 1 guest = 3 non-organizer invitees.
    expect(result[0]?.nonOrganizerInviteeCount).toBe(3);
  });
});
