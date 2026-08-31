import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";

type T = ReturnType<typeof createTestContext>;

/** Tuesday 1 September 2026, 09:00–09:30 Rome — the same standup the rest of
 *  the series suite meets in. */
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

/** Add a workspace member AND the user node the `workspaceMembers` trigger
 *  would have written, since the raw insert used here bypasses it. Without the
 *  node an invite edge would resolve `targetNodeId` to undefined — the same
 *  helper, for the same reason, as `calendarEvents.inviteEdges.test.ts`. */
async function addMember(t: T, workspaceId: Id<"workspaces">, email: string) {
  const { userId, asUser } = await setupAuthenticatedUser(t, { email });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "member",
    });
    const user = await ctx.db.get(userId);
    await ctx.db.insert("nodes", {
      workspaceId,
      resourceType: "user",
      resourceId: userId,
      name: user?.name ?? user?.email ?? "Unknown",
      tags: [],
      searchable: true,
    });
  });
  return { userId, asUser };
}

/** Every `invites` edge pointing out of this series. */
async function inviteEdges(t: T, seriesId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", seriesId))
      .collect()
      .then((rows) =>
        rows.filter((e) => e.edgeType === "invites" && e.targetType === "user"),
      ),
  );
}

describe("inviting someone to a series", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("connects them to it in the workspace graph", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await addMember(t, workspaceId, "alice@test.com");

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    expect(await inviteEdges(t, seriesId)).toHaveLength(0);

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [aliceId],
      guestEmails: [],
    });

    const edges = await inviteEdges(t, seriesId);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceType).toBe("eventSeries");
    expect(edges[0]?.sourceId).toBe(seriesId);
    expect(edges[0]?.targetId).toBe(aliceId);
    expect(edges[0]?.workspaceId).toBe(workspaceId);
    // Both endpoints resolved to node ids, so the graph can draw the link.
    expect(edges[0]?.sourceNodeId).toBeDefined();
    expect(edges[0]?.targetNodeId).toBeDefined();
  });
});

describe("removing someone from a series", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("disconnects them from it again", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await addMember(t, workspaceId, "alice@test.com");

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [aliceId],
      guestEmails: [],
    });
    expect(await inviteEdges(t, seriesId)).toHaveLength(1);

    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    await organizer.mutation(api.eventSeries.removeInvitee, {
      inviteeId: roster[0]!._id,
    });

    expect(await inviteEdges(t, seriesId)).toHaveLength(0);
  });
});

describe("the organizer of a series", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("is connected to it only once they say they are attending", async () => {
    // The reason self-invite is opt-in rather than automatic, stated as an
    // edge. An organizer is connected to every meeting they book, so an
    // automatic edge would be true of all of them and would therefore
    // distinguish none of them. Drawn only when they choose it, the edge means
    // "I am in the room", which is worth a line in the graph.
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    // The organizer's own user node, which `setupWorkspaceWithAdmin`'s raw
    // membership insert bypassed the trigger for — the same stand-in, for the
    // same reason, as `addMember` above.
    await t.run(async (ctx) => {
      const [me] = await ctx.db.query("users").collect();
      await ctx.db.insert("nodes", {
        workspaceId,
        resourceType: "user",
        resourceId: me!._id,
        name: me!.name ?? me!.email ?? "Unknown",
        tags: [],
        searchable: true,
      });
    });

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    expect(await inviteEdges(t, seriesId)).toHaveLength(0);

    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });

    const edges = await inviteEdges(t, seriesId);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceType).toBe("eventSeries");
    expect(edges[0]?.targetNodeId).toBeDefined();
  });

  it("is disconnected again if they take themselves back off the roster", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    await t.run(async (ctx) => {
      const [me] = await ctx.db.query("users").collect();
      await ctx.db.insert("nodes", {
        workspaceId,
        resourceType: "user",
        resourceId: me!._id,
        name: me!.name ?? me!.email ?? "Unknown",
        tags: [],
        searchable: true,
      });
    });
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });
    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    await organizer.mutation(api.eventSeries.removeInvitee, {
      inviteeId: roster[0]!._id,
    });

    // Back to where they started, and free to opt in again — the shortcut is
    // reversible, so it is not a decision anyone has to be careful about.
    expect(await inviteEdges(t, seriesId)).toHaveLength(0);
    await organizer.mutation(api.eventSeries.selfInvite, { seriesId });
    expect(await inviteEdges(t, seriesId)).toHaveLength(1);
  });
});

describe("inviting an external guest to a series", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("connects nobody, exactly as on a one-off event", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@outside.com"],
    });

    // The guest is on the roster…
    const roster = await organizer.query(api.eventSeries.listInvitees, {
      seriesId,
    });
    expect(roster).toHaveLength(1);
    // …and connected to nothing: there is no workspace user to connect them to.
    expect(await inviteEdges(t, seriesId)).toHaveLength(0);
  });
});

describe("cancelling a series someone was invited to", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("leaves no edge behind, in either direction", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await addMember(t, workspaceId, "alice@test.com");

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [aliceId],
      guestEmails: [],
    });
    expect(await inviteEdges(t, seriesId)).toHaveLength(1);

    await organizer.mutation(api.eventSeries.cancel, { seriesId });

    // Neither the edge out of the series nor anything pointing back at it.
    const bySource = await t.run((ctx) =>
      ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", seriesId))
        .collect(),
    );
    const byTarget = await t.run((ctx) =>
      ctx.db
        .query("edges")
        .withIndex("by_target", (q) => q.eq("targetId", seriesId))
        .collect(),
    );
    expect(bySource).toHaveLength(0);
    expect(byTarget).toHaveLength(0);

    // And the roster went with it.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("eventSeriesInvitees")
        .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("a series someone is invited to, removed from and invited to again", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("still holds exactly one node and exactly one edge", async () => {
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: aliceId } = await addMember(t, workspaceId, "alice@test.com");

    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    for (let round = 0; round < 2; round++) {
      await organizer.mutation(api.eventSeries.addInvitees, {
        seriesId,
        userIds: [aliceId],
        guestEmails: [],
      });
      expect(await inviteEdges(t, seriesId)).toHaveLength(1);
      const roster = await organizer.query(api.eventSeries.listInvitees, {
        seriesId,
      });
      await organizer.mutation(api.eventSeries.removeInvitee, {
        inviteeId: roster[0]!._id,
      });
    }

    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [aliceId],
      guestEmails: [],
    });

    expect(await inviteEdges(t, seriesId)).toHaveLength(1);
    const nodes = await t.run((ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", seriesId))
        .collect(),
    );
    expect(nodes).toHaveLength(1);
  });
});

describe("an invitee who belongs to two workspaces", () => {
  let t: T;
  beforeEach(() => {
    t = createTestContext();
  });

  it("is connected to their identity in the series' own workspace", async () => {
    // User nodes are per-membership, so Carol has one node per workspace. A
    // workspace-blind lookup returns whichever came first — deliberately, here,
    // the one in the workspace the series is NOT in.
    const a = await setupWorkspaceWithAdmin(t, "Workspace A");
    const b = await setupWorkspaceWithAdmin(t, "Workspace B");
    const { userId: carolId } = await setupAuthenticatedUser(t, {
      name: "Carol",
      email: "carol@test.com",
    });
    for (const ws of [a.workspaceId, b.workspaceId]) {
      await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", {
          workspaceId: ws,
          userId: carolId,
          role: "member",
        });
        await ctx.db.insert("nodes", {
          workspaceId: ws,
          resourceType: "user",
          resourceId: carolId,
          name: "Carol",
          tags: [],
          searchable: true,
        });
      });
    }

    const seriesId = await b.asUser.mutation(api.eventSeries.create, {
      workspaceId: b.workspaceId,
      ...WEEKLY_STANDUP,
    });
    await b.asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [carolId],
      guestEmails: [],
    });

    // Independent source of truth: Carol's node looked up BY workspace, which
    // is not how the trigger resolves it.
    const carolNodeInB = await t.run((ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource_workspace", (q) =>
          q.eq("resourceId", carolId as string).eq("workspaceId", b.workspaceId),
        )
        .first(),
    );

    const edges = await inviteEdges(t, seriesId);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.workspaceId).toBe(b.workspaceId);
    expect(
      edges[0]?.targetNodeId,
      "the edge's workspace and its targetNodeId's workspace must agree",
    ).toBe(carolNodeInB?._id);
  });
});
