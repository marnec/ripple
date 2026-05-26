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

    it("marks an open channel read for a workspace member (no channelMembers row)", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      // Open channels have no channelMembers rows — access is via workspace
      // membership, so markRead must still record a read marker.
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
      expect(state?.lastReadAt).toBeDefined();
      expect(state!.lastReadAt!).toBeGreaterThan(0);
    });

    it("is a no-op on a closed channel the user hasn't joined", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "closed-channel", workspaceId, type: "closed" as const }),
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

  describe("getUnreadStatus", () => {
    it("uses join time as baseline when never visited: messages after joining are unread", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      // Membership is created first, then a message arrives — no lastReadAt yet.
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await insertMessage(t, { channelId, userId });

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: true }]);
    });

    it("does not count messages sent before the user joined", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

      // Channel + a message exist first; the user joins afterwards (later
      // _creationTime), so the pre-existing message is not "unread".
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "pre-join", workspaceId, type: "closed" as const }),
      );
      await insertMessage(t, { channelId, userId });
      await t.run(async (ctx) =>
        ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId,
          role: ChannelRole.MEMBER,
        }),
      );

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: false }]);
    });

    it("open channel: workspace-join time is the baseline when never visited", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      // Open channel, no channelMembers row, no lastReadAt. The user is a
      // workspace member (joined before the channel existed), so a later
      // message should register as unread off the workspace-join baseline.
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "open-channel", workspaceId, type: "open" as const }),
      );

      await insertMessage(t, { channelId, userId });

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: true }]);
    });

    it("open channel: lastReadAt clears the badge once read", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await t.run(async (ctx) =>
        ctx.db.insert("channels", { name: "open-channel", workspaceId, type: "open" as const }),
      );

      await insertMessage(t, { channelId, userId });
      // Reading the channel records a lastReadAt newer than the message.
      await asUser.mutation(api.channelReads.markRead, { channelId });

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: false }]);
    });

    it("returns true when there are messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: Date.now() - 10000 });

      await insertMessage(t, { channelId, userId });
      await insertMessage(t, { channelId, userId });

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: true }]);
    });

    it("returns false when no messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await insertMessage(t, { channelId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: Date.now() + 100000 });

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: false }]);
    });

    it("ignores soft-deleted messages after lastReadAt", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await seedLastReadAt(t, { workspaceId, channelId, userId, at: Date.now() - 10000 });

      // The only message after lastReadAt is deleted → nothing live to read.
      const messageId = await insertMessage(t, { channelId, userId });
      await t.run(async (ctx) => ctx.db.patch(messageId, { deleted: true }));

      const status = await asUser.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] });
      expect(status).toEqual([{ channelId, hasUnread: false }]);
    });

    it("returns results for multiple channels", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId1 = await setupChannelWithMembership(t, { workspaceId, userId });
      const channelId2 = await setupChannelWithMembership(t, { workspaceId, userId });

      const seedAt = Date.now() - 10000;
      await seedLastReadAt(t, { workspaceId, channelId: channelId1, userId, at: seedAt });
      await seedLastReadAt(t, { workspaceId, channelId: channelId2, userId, at: seedAt });

      // Messages in channel1, none in channel2.
      await insertMessage(t, { channelId: channelId1, userId });
      await insertMessage(t, { channelId: channelId1, userId });

      const status = await asUser.query(api.channelReads.getUnreadStatus, {
        channelIds: [channelId1, channelId2],
      });
      expect(status).toHaveLength(2);
      expect(status.find((c) => c.channelId === channelId1)?.hasUnread).toBe(true);
      expect(status.find((c) => c.channelId === channelId2)?.hasUnread).toBe(false);
    });

    it("rejects unauthenticated calls", async () => {
      const t = createTestContext();
      const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupChannelWithMembership(t, { workspaceId, userId });

      await expect(
        t.query(api.channelReads.getUnreadStatus, { channelIds: [channelId] }),
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
