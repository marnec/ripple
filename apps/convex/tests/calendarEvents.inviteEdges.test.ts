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

/** Insert a workspace member AND the matching user node. The raw
 *  `ctx.db.insert` used here bypasses the `workspaceMembers` trigger
 *  (the trigger only fires on writes routed through writerWithTriggers
 *  from a mutation), so we manually mirror what the trigger would do:
 *  create the user node. Without this, edges from the invitee trigger
 *  would resolve `targetNodeId` to undefined and the test assertions
 *  on node-id presence would fail. Production mutations always route
 *  through writerWithTriggers, so they don't have this problem. */
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
    const user = await ctx.db.get(userId as any);
    await ctx.db.insert("nodes", {
      workspaceId: workspaceId as any,
      resourceType: "user",
      resourceId: userId,
      name: (user as any)?.name ?? (user as any)?.email ?? "Unknown",
      tags: [],
      searchable: true,
    });
  });
}

async function inviteEdges(t: TestContext, eventId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", eventId))
      .collect()
      .then((rows) =>
        rows.filter(
          (e) => e.edgeType === "invites" && e.targetType === "user",
        ),
      ),
  );
}

describe("calendarEventInvitees → `invites` edge trigger", () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });

  it("creating an event with a member invitee inserts the `invites` edge", async () => {
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

    const edges = await inviteEdges(t, eventId);
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(edge?.sourceType).toBe("calendarEvent");
    expect(edge?.sourceId).toBe(eventId);
    expect(edge?.targetId).toBe(memberId);
    expect(edge?.workspaceId).toBe(workspaceId);
    // Both endpoints resolved to node ids.
    expect(edge?.sourceNodeId).toBeDefined();
    expect(edge?.targetNodeId).toBeDefined();
  });

  it("guest invitees do NOT get an `invites` edge (no user node)", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: ["guest@x.com"] },
    });

    const edges = await inviteEdges(t, eventId);
    expect(edges).toHaveLength(0);
  });

  it("organiser does NOT get an edge by default (only on explicit selfInvite)", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Solo focus block",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    // No invitee row was written for the organiser → no edge.
    expect(await inviteEdges(t, eventId)).toHaveLength(0);

    // After self-invite the edge appears.
    await asUser.mutation(api.calendarEvents.selfInvite, { eventId });
    const after = await inviteEdges(t, eventId);
    expect(after).toHaveLength(1);
    expect(after[0]?.edgeType).toBe("invites");
  });

  it("addInvitees inserts the edge for each new member", async () => {
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await setupAuthenticatedUser(t, {
      email: "alice@test.com",
    });
    const { userId: bobId } = await setupAuthenticatedUser(t, {
      email: "bob@test.com",
    });
    await addMember(t, workspaceId, aliceId, WorkspaceRole.MEMBER);
    await addMember(t, workspaceId, bobId, WorkspaceRole.MEMBER);

    const eventId = await asUser.mutation(api.calendarEvents.create, {
      workspaceId: workspaceId as any,
      title: "Sync",
      startsAt: Date.now() + ONE_HOUR,
      endsAt: Date.now() + 2 * ONE_HOUR,
      timezone: "UTC",
      invitees: { userIds: [], guestEmails: [] },
    });

    expect(await inviteEdges(t, eventId)).toHaveLength(0);

    await asUser.mutation(api.calendarEvents.addInvitees, {
      eventId,
      userIds: [aliceId as any, bobId as any],
      guestEmails: [],
    });

    const edges = await inviteEdges(t, eventId);
    expect(edges).toHaveLength(2);
    const targetIds = edges.map((e) => e.targetId).sort();
    expect(targetIds).toEqual([aliceId, bobId].sort());
  });

  it("removeInvitee tears down the corresponding edge", async () => {
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
    expect(await inviteEdges(t, eventId)).toHaveLength(1);

    // Look up the invitee row id to feed into removeInvitee.
    const detail = await asUser.query(api.calendarEvents.get, { eventId });
    const inviteeId = detail.invitees[0]?._id;
    expect(inviteeId).toBeDefined();
    await asUser.mutation(api.calendarEvents.removeInvitee, {
      inviteeId: inviteeId!,
    });

    expect(await inviteEdges(t, eventId)).toHaveLength(0);
  });

  it("event cancellation cascades — invitee rows AND edges both gone", async () => {
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
    expect(await inviteEdges(t, eventId)).toHaveLength(1);

    await asUser.mutation(api.calendarEvents.cancel, { eventId });

    expect(await inviteEdges(t, eventId)).toHaveLength(0);
    const invitees = await t.run(async (ctx) =>
      ctx.db
        .query("calendarEventInvitees")
        .withIndex("by_event", (q) => q.eq("eventId", eventId as any))
        .collect(),
    );
    expect(invitees).toHaveLength(0);
  });
});
