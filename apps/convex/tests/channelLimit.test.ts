import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupAuthenticatedUser, setupWorkspaceWithAdmin } from "./helpers";
import { WORKSPACE_CHANNEL_LIMIT } from "@ripple/shared/constants";
import type { Id } from "../convex/_generated/dataModel";

/** Seed `count` channels of `type` directly, bypassing the mutation's gate. */
async function seedChannels(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; count: number; type: "open" | "closed" | "dm" },
) {
  const { workspaceId, count, type } = opts;
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("channels", { name: `${type}-${i}`, workspaceId, type });
    }
  });
}

describe("channels.create — per-workspace channel limit", () => {
  it("allows creation up to the limit", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT - 1, type: "open" });

    const channelId = await asUser.mutation(api.channels.create, {
      name: "the last one",
      workspaceId,
      type: "open",
    });

    expect(channelId).toBeDefined();
  });

  it("refuses the one past the limit", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT, type: "open" });

    await expect(
      asUser.mutation(api.channels.create, { name: "one too many", workspaceId, type: "open" }),
    ).rejects.toThrow(/limit of 150 channels/);
  });

  it("counts open and closed channels together", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const half = Math.floor(WORKSPACE_CHANNEL_LIMIT / 2);
    await seedChannels(t, { workspaceId, count: half, type: "open" });
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT - half, type: "closed" });

    await expect(
      asUser.mutation(api.channels.create, { name: "over", workspaceId, type: "closed" }),
    ).rejects.toThrow(/limit of 150 channels/);
  });

  it("does not count DMs toward the limit", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT, type: "dm" });

    const channelId = await asUser.mutation(api.channels.create, {
      name: "channels are not DMs",
      workspaceId,
      type: "open",
    });

    expect(channelId).toBeDefined();
  });

  it("does not block a DM in a workspace that is at the channel limit", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT, type: "open" });

    const { userId: otherId } = await setupAuthenticatedUser(t, {
      name: "Colleague",
      email: "colleague@example.com",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" });
    });

    const dmId = await asUser.mutation(api.channels.createDm, {
      workspaceId,
      otherUserId: otherId,
    });

    expect(dmId, "messaging a colleague must not depend on the channel budget").toBeDefined();
    expect(userId).toBeDefined();
  });

  it("scopes the limit to one workspace", async () => {
    const t = createTestContext();
    const { workspaceId, asUser, userId } = await setupWorkspaceWithAdmin(t);
    await seedChannels(t, { workspaceId, count: WORKSPACE_CHANNEL_LIMIT, type: "open" });

    const otherWorkspaceId = await t.run(async (ctx) => {
      const wsId = await ctx.db.insert("workspaces", { name: "Elsewhere", ownerId: userId });
      await ctx.db.insert("workspaceMembers", { userId, workspaceId: wsId, role: "admin" });
      return wsId;
    });

    const channelId = await asUser.mutation(api.channels.create, {
      name: "fresh workspace",
      workspaceId: otherWorkspaceId,
      type: "open",
    });

    expect(channelId).toBeDefined();
  });
});
