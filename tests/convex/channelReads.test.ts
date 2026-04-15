import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@shared/enums/roles";
import type { Id } from "../../convex/_generated/dataModel";

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

describe("channelReads", () => {
  describe("markRead", () => {
    it("sets lastReadAt on the channelMember row", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await asUser.mutation(api.channelReads.markRead, { channelId });

      const membership = await t.run(async (ctx) => {
        return ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .first();
      });

      expect(membership?.lastReadAt).toBeDefined();
      expect(membership!.lastReadAt).toBeGreaterThan(0);
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

      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .first();
        if (membership) {
          await ctx.db.patch(membership._id, { lastReadAt: Date.now() - 10000 });
        }
      });

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

      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .first();
        if (membership) {
          await ctx.db.patch(membership._id, { lastReadAt: Date.now() + 100000 });
        }
      });

      const counts = await asUser.query(api.channelReads.getUnreadCounts, { channelIds: [channelId] });
      expect(counts).toEqual([{ channelId, count: 0 }]);
    });

    it("returns results for multiple channels", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId1 = await setupChannelWithMembership(t, { workspaceId, userId });
      const channelId2 = await setupChannelWithMembership(t, { workspaceId, userId });

      // Set lastReadAt on both channels
      await t.run(async (ctx) => {
        for (const channelId of [channelId1, channelId2]) {
          const membership = await ctx.db
            .query("channelMembers")
            .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
            .first();
          if (membership) {
            await ctx.db.patch(membership._id, { lastReadAt: Date.now() - 10000 });
          }
        }
      });

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
});
