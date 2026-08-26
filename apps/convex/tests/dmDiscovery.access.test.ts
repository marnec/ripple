import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createTestContext, setupAuthenticatedUser, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { withTriggers } from "../convex/dbTriggers";

/**
 * A DM's label *is* its roster — "Bob Bobson × Carol Carolson" names both
 * participants. So every workspace-wide discovery surface has to treat a DM
 * the way `channelMembers.membersByChannel` treats a private roster: it does
 * not reach a non-participant.
 *
 * There are three such surfaces — `channels.search`, `nodes.search` and
 * `graph.getWorkspaceGraph` — and all three used to hand a DM label to any
 * workspace member who typed a participant's name.
 */
async function setupWorkspaceWithDm(t: ReturnType<typeof createTestContext>) {
  const { userId: aliceId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const { userId: bobId } = await setupAuthenticatedUser(t, {
    name: "Bob Bobson",
    email: "bob@example.com",
  });
  const { userId: outsiderId, asUser: asOutsider } = await setupAuthenticatedUser(t, {
    name: "Nosy Outsider",
    email: "nosy@example.com",
  });

  const dmId = await t.run(async (ctx) => {
    // Through the trigger-aware writer: the workspaceMembers insert trigger is
    // what creates each member's `user` node, which is how the command palette
    // finds people.
    for (const userId of [bobId, outsiderId]) {
      await withTriggers(ctx).db.insert("workspaceMembers", { userId, workspaceId, role: "member" });
    }
    // Through the trigger-aware writer, so the `nodes` mirror is built by the
    // real channels trigger rather than by hand.
    const channelId = await withTriggers(ctx).db.insert("channels", {
      name: "Bob Bobson × Test User",
      workspaceId,
      type: "dm",
    });
    for (const userId of [aliceId, bobId]) {
      await ctx.db.insert("channelMembers", { channelId, workspaceId, userId, role: "member" });
    }
    return channelId;
  });

  return { aliceId, bobId, outsiderId, asOutsider, workspaceId, dmId };
}

async function seedChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; name: string; type: "open" | "closed" },
) {
  return await t.run((ctx) => ctx.db.insert("channels", { ...opts }));
}

describe("channels.search — DMs are not workspace-wide discoverable", () => {
  it("does not return a DM to a non-participant searching a participant's name", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);

    const result = await asOutsider.query(api.channels.search, {
      workspaceId,
      searchText: "Bob",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(
      result.page.filter((c) => c.type === "dm"),
      "a DM label names both participants — it must not reach a non-participant",
    ).toEqual([]);
  });

  it("does not return DMs when a caller asks for them by type", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);

    // The arg validator used to accept the full `channelTypeSchema`, so a
    // caller could name the private type directly and skip the browse UI's
    // open/private toggle entirely. "dm" is not a browsable type, so the
    // right answer is a rejected call, not an empty page.
    await expect(
      asOutsider.query(api.channels.search, {
        workspaceId,
        // @ts-expect-error — "dm" is no longer an accepted browse type.
        type: "dm",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });

  it("still returns open and closed channels", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);
    await seedChannel(t, { workspaceId, name: "Bob's Open Channel", type: "open" });
    await seedChannel(t, { workspaceId, name: "Bob's Closed Channel", type: "closed" });

    const result = await asOutsider.query(api.channels.search, {
      workspaceId,
      searchText: "Bob",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page.map((c) => c.type).sort()).toEqual(["closed", "open"]);
  });

  it("does not list DMs when browsing with no search text and no type", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);
    await seedChannel(t, { workspaceId, name: "General", type: "open" });
    await seedChannel(t, { workspaceId, name: "Leadership", type: "closed" });

    // This is the browse UI's "all" filter: open + closed, never DMs.
    const result = await asOutsider.query(api.channels.search, {
      workspaceId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    expect(result.page.filter((c) => c.type === "dm")).toEqual([]);
    expect(result.page.map((c) => c.name).sort()).toEqual(["General", "Leadership"]);
  });

  it("keeps browse pages dense when a workspace holds many DMs", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 40; i++) {
        await ctx.db.insert("channels", { name: `dm-${i}`, workspaceId, type: "dm" });
      }
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("channels", { name: `open-${i}`, workspaceId, type: "open" });
      }
    });

    // Discarding DMs after the read would yield a nearly empty first page.
    const result = await asOutsider.query(api.channels.search, {
      workspaceId,
      paginationOpts: { numItems: 5, cursor: null },
    });

    expect(result.page, "the page must be filled from browsable rows, not padded with rejects").toHaveLength(5);
    expect(result.page.every((c) => c.type !== "dm")).toBe(true);
  });
});

describe("nodes.search — DMs are not workspace-wide discoverable", () => {
  it("does not return a DM node to a non-participant", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId, dmId } = await setupWorkspaceWithDm(t);

    // The channels trigger mirrors every channel into `nodes`, so the DM label
    // is reachable through the global search box as well as the browse page.
    const results = await asOutsider.query(api.nodes.search, {
      workspaceId,
      searchText: "Bob",
    });

    expect(results.filter((r) => r.resourceId === dmId)).toEqual([]);
  });
});

describe("graph.getWorkspaceGraph — DMs are not workspace-wide discoverable", () => {
  it("does not draw a DM node for a non-participant", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId, dmId } = await setupWorkspaceWithDm(t);

    const graph = await asOutsider.query(api.graph.getWorkspaceGraph, { workspaceId });

    expect(
      graph.nodes.filter((n) => n.id === dmId),
      "a private two-person conversation has no place in a workspace-wide graph",
    ).toEqual([]);
  });

  it("still draws ordinary channels", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);
    const openId = await t.run((ctx) =>
      withTriggers(ctx).db.insert("channels", { name: "General", workspaceId, type: "open" }),
    );

    const graph = await asOutsider.query(api.graph.getWorkspaceGraph, { workspaceId });

    expect(graph.nodes.filter((n) => n.id === openId)).toHaveLength(1);
  });
});

/**
 * The trigger only covers DMs created from now on. Every DM that already
 * exists still carries the `nodes` row that made it discoverable, so the
 * exclusion needs a repair pass over the existing data — the same
 * widen-then-strip shape `stripNodeTags` uses.
 */
describe("migrations.stripDmDiscoverability", () => {
  it("removes the node row a legacy DM still carries", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId, dmId } = await setupWorkspaceWithDm(t);

    // A DM predating the trigger change: the node row is already there.
    await t.run(async (ctx) => {
      await ctx.db.insert("nodes", {
        workspaceId,
        resourceType: "channel",
        resourceId: dmId,
        name: "Bob Bobson × Test User",
        searchable: true,
      });
    });

    // Reachable before the repair.
    const before = await asOutsider.query(api.nodes.search, { workspaceId, searchText: "Bob" });
    expect(before.filter((r) => r.resourceId === dmId)).toHaveLength(1);

    await t.mutation(internal.migrations.stripDmDiscoverability, { cursor: null, batchSize: 100 });
    await t.finishAllScheduledFunctions(() => {});

    const after = await asOutsider.query(api.nodes.search, { workspaceId, searchText: "Bob" });
    expect(after.filter((r) => r.resourceId === dmId)).toEqual([]);

    const graph = await asOutsider.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(graph.nodes.filter((n) => n.id === dmId)).toEqual([]);
  });

  it("blanks the rendered label a legacy DM still stores", async () => {
    const t = createTestContext();
    const { workspaceId, dmId } = await setupWorkspaceWithDm(t);

    // The fixture seeds the pre-change shape: a stored `<A> × <B>` snapshot.
    expect((await t.run((ctx) => ctx.db.get(dmId)))?.name).toBe("Bob Bobson × Test User");

    await t.mutation(internal.migrations.stripDmDiscoverability, { cursor: null, batchSize: 100 });
    await t.finishAllScheduledFunctions(() => {});

    expect(
      (await t.run((ctx) => ctx.db.get(dmId)))?.name,
      "nothing reads it any more, and a stale roster string is a trap for whoever next writes `channel.name`",
    ).toBe("");
    expect(workspaceId).toBeDefined();
  });

  it("leaves nodes for ordinary channels alone", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId } = await setupWorkspaceWithDm(t);
    const openId = await t.run((ctx) =>
      withTriggers(ctx).db.insert("channels", { name: "General", workspaceId, type: "open" }),
    );

    await t.mutation(internal.migrations.stripDmDiscoverability, { cursor: null, batchSize: 100 });
    await t.finishAllScheduledFunctions(() => {});

    const graph = await asOutsider.query(api.graph.getWorkspaceGraph, { workspaceId });
    expect(graph.nodes.filter((n) => n.id === openId)).toHaveLength(1);
  });
});

/**
 * Removing DMs from workspace-wide discovery does not remove the ability to
 * reach one. The way you find a conversation is by finding the *person* —
 * Ctrl+K searches `nodes`, which carries one row per workspace user, and
 * selecting a person calls `channels.createDm` (get-or-create) and navigates.
 *
 * That lane is the reason the DM exclusion costs no capability, so it is
 * pinned here rather than left implicit.
 */
describe("finding a DM by the person instead of the label", () => {
  it("surfaces the person through the same search the palette uses", async () => {
    const t = createTestContext();
    const { asOutsider, workspaceId, bobId } = await setupWorkspaceWithDm(t);

    const results = await asOutsider.query(api.nodes.search, {
      workspaceId,
      searchText: "Bob",
    });

    expect(
      results.find((r) => r.resourceType === "user" && r.resourceId === bobId),
      "a colleague must stay findable by name even though their DM is not",
    ).toBeDefined();
  });

  it("opens the existing DM rather than creating a second one", async () => {
    const t = createTestContext();
    const { workspaceId, aliceId, bobId, dmId } = await setupWorkspaceWithDm(t);
    const asAlice = t.withIdentity({ subject: `${aliceId}|test-session` });

    const opened = await asAlice.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: bobId,
    });

    expect(opened, "createDm is get-or-create — the People lane reuses the conversation").toBe(dmId);
  });
});
