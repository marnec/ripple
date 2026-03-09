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
      isPublic: false,
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

  describe("getUnreadCount", () => {
    it("returns 0 when lastReadAt is undefined (new member)", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      // Insert a message but don't mark read
      await insertMessage(t, { channelId, userId });

      const count = await asUser.query(api.channelReads.getUnreadCount, { channelId });
      expect(count).toBe(0);
    });

    it("returns correct count for messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      // Mark as read first
      await asUser.mutation(api.channelReads.markRead, { channelId });

      // Insert messages after marking read
      await insertMessage(t, { channelId, userId });
      await insertMessage(t, { channelId, userId });

      const count = await asUser.query(api.channelReads.getUnreadCount, { channelId });
      expect(count).toBe(2);
    });

    it("returns 0 when no messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await insertMessage(t, { channelId, userId });

      // Set lastReadAt to far future to ensure all messages are before it
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
          .first();
        if (membership) {
          await ctx.db.patch(membership._id, { lastReadAt: Date.now() + 100000 });
        }
      });

      const count = await asUser.query(api.channelReads.getUnreadCount, { channelId });
      expect(count).toBe(0);
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await expect(
        t.query(api.channelReads.getUnreadCount, { channelId }),
      ).rejects.toThrow("Not authenticated");
    });
  });
});
