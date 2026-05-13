import { expect, describe, it } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@ripple/shared/enums/roles";
import type { Id } from "../convex/_generated/dataModel";

async function setupChannelWithMembership(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name: "test-channel",
      workspaceId: opts.workspaceId,
      type: "closed" as const,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      role: ChannelRole.ADMIN,
    });
    return channelId;
  });
}

async function insertMessage(
  t: ReturnType<typeof createTestContext>,
  opts: { channelId: Id<"channels">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    return ctx.db.insert("messages", {
      channelId: opts.channelId,
      userId: opts.userId,
      isomorphicId: `msg-${Date.now()}-${Math.random()}`,
      body: "test message",
      plainText: "test message",
      deleted: false,
    });
  });
}

/** Directly seed a userChannelState.lastReadAt for the given user/channel. */
async function seedLastReadAt(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; channelId: Id<"channels">; userId: Id<"users">; at: number },
) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("userChannelState")
      .withIndex("by_channel_user", (q) => q.eq("channelId", opts.channelId).eq("userId", opts.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastReadAt: opts.at });
    } else {
      await ctx.db.insert("userChannelState", {
        userId: opts.userId,
        channelId: opts.channelId,
        workspaceId: opts.workspaceId,
        lastReadAt: opts.at,
      });
    }
  });
}

describe("channelReads", () => {
  describe("markRead", () => {
    it("inserts a userChannelState row with lastReadAt for a fresh member", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await asUser.mutation(api.channelReads.markRead, { channelId });

      const state = await t.run(async (ctx) => {
        return ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .unique();
      });

      expect(state?.lastReadAt).toBeDefined();
      expect(state!.lastReadAt!).toBeGreaterThan(0);
      expect(state!.workspaceId).toBe(workspaceId);
    });

    it("patches lastReadAt on an existing userChannelState row", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: 1 });
      await asUser.mutation(api.channelReads.markRead, { channelId });

      const rows = await t.run(async (ctx) => {
        return ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .collect();
      });

      // Exactly one row — patched, not duplicated.
      expect(rows).toHaveLength(1);
      expect(rows[0].lastReadAt!).toBeGreaterThan(1);
    });

    it("is a no-op when the user has no channelMembers row", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "open-channel", workspaceId, type: "open" as const }),
      );

      await asUser.mutation(api.channelReads.markRead, { channelId });

      const state = await t.run(async (ctx) => {
        return ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .unique();
      });
      expect(state).toBeNull();
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await expect(
        t.mutation(api.channelReads.markRead, { channelId }),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("getUnreadCounts", () => {
    it("returns 0 when lastReadAt is undefined (new member)", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await insertMessage(t, { channelId, userId });

      const counts = await asUser.query(api.channelReads.getUnreadCounts, { channelIds: [channelId] });
      expect(counts).toEqual([{ channelId, count: 0 }]);
    });

    it("returns correct count for messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: Date.now() - 10000 });

      await insertMessage(t, { channelId, userId });
      await insertMessage(t, { channelId, userId });

      const counts = await asUser.query(api.channelReads.getUnreadCounts, { channelIds: [channelId] });
      expect(counts).toEqual([{ channelId, count: 2 }]);
    });

    it("returns 0 when no messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await insertMessage(t, { channelId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: Date.now() + 100000 });

      const counts = await asUser.query(api.channelReads.getUnreadCounts, { channelIds: [channelId] });
      expect(counts).toEqual([{ channelId, count: 0 }]);
    });

    it("returns results for multiple channels", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId1 = await setupChannelWithMembership(t, { workspaceId, userId });
      const channelId2 = await setupChannelWithMembership(t, { workspaceId, userId });

      const seedAt = Date.now() - 10000;
      await seedLastReadAt(t, { workspaceId, channelId: channelId1, userId, at: seedAt });
      await seedLastReadAt(t, { workspaceId, channelId: channelId2, userId, at: seedAt });

      // 2 messages in channel1, 1 in channel2
      await insertMessage(t, { channelId: channelId1, userId });
      await insertMessage(t, { channelId: channelId1, userId });
      await insertMessage(t, { channelId: channelId2, userId });

      const counts = await asUser.query(api.channelReads.getUnreadCounts, {
        channelIds: [channelId1, channelId2],
      });
      expect(counts).toHaveLength(2);
      expect(counts.find((c) => c.channelId === channelId1)?.count).toBe(2);
      expect(counts.find((c) => c.channelId === channelId2)?.count).toBe(1);
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await expect(
        t.query(api.channelReads.getUnreadCounts, { channelIds: [channelId] }),
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("userChannelState cleanup", () => {
    it("is deleted when the user's channelMembers row is removed", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      // Seed unread state for an extra member, then remove them.
      const { userId: otherId } = await t.run(async (ctx) => {
        const otherId = await ctx.db.insert("users", { name: "Other", email: "o@x.io" });
        await ctx.db.insert("workspaceMembers", { userId: otherId, workspaceId, role: "member" });
        await ctx.db.insert("channelMembers", {
          channelId, workspaceId, userId: otherId, role: ChannelRole.MEMBER,
        });
        return { userId: otherId };
      });
      await seedLastReadAt(t, { workspaceId, channelId, userId: otherId, at: Date.now() });

      await asUser.mutation(api.channelMembers.removeFromChannel, {
        userId: otherId,
        channelId,
      });

      const state = await t.run(async (ctx) => {
        return ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", otherId))
          .unique();
      });
      expect(state).toBeNull();
    });
  });
});
