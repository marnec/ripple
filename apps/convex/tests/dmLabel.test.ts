import { describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupAuthenticatedUser, setupWorkspaceWithAdmin, channelFields } from "./helpers";
import { withTriggers } from "../convex/dbTriggers";

/**
 * A DM's label is derived, not stored.
 *
 * It used to be materialized onto `channels.name` because that column backs
 * `channels.searchIndex("by_name")` and a search index cannot index a computed
 * value — and a materialized label then needed a fan-out job to keep it fresh
 * on every rename. Now that a DM is not workspace-wide discoverable there is
 * no index to feed, so the label is resolved from the participants at read
 * time and the job is gone.
 */
async function setupDm(t: ReturnType<typeof createTestContext>) {
  const { userId: aliceId, workspaceId, asUser: asAlice } = await setupWorkspaceWithAdmin(t);
  const { userId: bobId } = await setupAuthenticatedUser(t, {
    name: "Bob Bobson",
    email: "bob@example.com",
  });
  await t.run(async (ctx) => {
    await withTriggers(ctx).db.insert("workspaceMembers", {
      userId: bobId,
      workspaceId,
      role: "member",
    });
  });
  const dmId = await asAlice.mutation(api.channels.createDm, {
    workspaceId,
    otherUserId: bobId,
  });
  return { aliceId, bobId, workspaceId, asAlice, dmId };
}

describe("DM labels are derived from participants", () => {
  it("stores no rendered label on the channel row", async () => {
    const t = createTestContext();
    const { dmId } = await setupDm(t);

    const channel = await t.run((ctx) => ctx.db.get(dmId));

    expect(
      channel?.name,
      "a stored label is what forced the rename fan-out; there should be nothing to keep fresh",
    ).toBe("");
  });

  it("shows the other participant's current name in the sidebar", async () => {
    const t = createTestContext();
    const { asAlice, workspaceId, dmId } = await setupDm(t);

    const data = await asAlice.query(api.workspaceSidebarData.get, { workspaceId });

    expect(data.channels.find((c) => c._id === dmId)?.name).toBe("Bob Bobson");
  });

  it("reflects a rename immediately, with no scheduled work at all", async () => {
    const t = createTestContext();
    const { asAlice, workspaceId, bobId, dmId } = await setupDm(t);

    await t.run(async (ctx) => {
      await withTriggers(ctx).db.patch(bobId, { name: "Zelda" });
    });

    // Deliberately no `finishAllScheduledFunctions`: a derived label has
    // nothing to wait for.
    const data = await asAlice.query(api.workspaceSidebarData.get, { workspaceId });

    expect(data.channels.find((c) => c._id === dmId)?.name).toBe("Zelda");
  });

  it("schedules nothing when a participant is renamed", async () => {
    const t = createTestContext();
    const { bobId } = await setupDm(t);

    await t.run(async (ctx) => {
      await withTriggers(ctx).db.patch(bobId, { name: "Zelda" });
    });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const dmJobs = scheduled.filter((s) => s.name.includes("userDenormalizationSync"));

    expect(dmJobs, "the DM-name fan-out job should no longer exist").toEqual([]);
    expect(vi).toBeDefined();
  });
});

/**
 * The label reads a bounded number of participants, because it is resolved on
 * every sidebar render and an unbounded read there is exactly what
 * `no-collect-in-query` exists to catch. A DM holds two people by construction
 * — `addToChannel` rejects a DM outright — so the bound has slack. If that
 * invariant ever changes, the label must say so rather than silently drop
 * people.
 */
describe("channels.get", () => {
  it("returns the derived label for a DM, not the empty stored column", async () => {
    const t = createTestContext();
    const { asAlice, dmId } = await setupDm(t);

    // The chat header, the call share sheet and the recent-items list all read
    // this query's `name`. With the label no longer stored, deriving it here
    // is what keeps every one of them correct without each having to know a
    // DM is special.
    const channel = await asAlice.query(api.channels.get, { id: dmId });

    expect(channel?.name).toBe("Bob Bobson");
  });

  it("still returns the stored name for an ordinary channel", async () => {
    const t = createTestContext();
    const { asAlice, workspaceId } = await setupDm(t);
    const openId = await t.run((ctx) =>
      withTriggers(ctx).db.insert("channels", { name: "General", workspaceId, ...channelFields("open")}),
    );

    const channel = await asAlice.query(api.channels.get, { id: openId });

    expect(channel?.name).toBe("General");
  });
});

describe("participant bound", () => {
  it("names the overflow instead of silently truncating", async () => {
    const t = createTestContext();
    const { asAlice, workspaceId, dmId } = await setupDm(t);

    // Deliberately violate the two-participant invariant, which the public
    // mutations refuse to do, to reach the bound.
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        const userId = await ctx.db.insert("users", {
          name: `Extra ${String(i).padStart(2, "0")}`,
          email: `extra${i}@example.com`,
        });
        await ctx.db.insert("channelMembers", {
          channelId: dmId,
          workspaceId,
          userId,
          role: "member",
        });
      }
    });

    const data = await asAlice.query(api.workspaceSidebarData.get, { workspaceId });
    const label = data.channels.find((c) => c._id === dmId)?.name ?? "";

    expect(label, "the count of unnamed participants must be visible").toMatch(/\+\d+$/);
  });
});
