import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { ChannelRole } from "@shared/enums/roles";
import type { Id } from "../../convex/_generated/dataModel";

/** Create a private channel with the given user as admin. */
async function setupPrivateChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users">; name?: string },
) {
  const { workspaceId, userId, name = "private-channel" } = opts;
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("channels", {
      name,
      workspaceId,
      isPublic: false,
    });
    await ctx.db.insert("channelMembers", {
      channelId,
      workspaceId,
      userId,
      role: ChannelRole.ADMIN,
    });
    return channelId;
  });
}

describe("channelMembers", () => {
  describe("addToChannel", () => {
    it("adds a user as a member", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      const { userId: otherUserId } = await setupAuthenticatedUser(t, {
        name: "Other User",
        email: "other@example.com",
      });

      // Add workspace membership for the other user
      await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", {
          userId: otherUserId,
          workspaceId,
          role: "member",
        });
      });

      await asUser.mutation(api.channelMembers.addToChannel, {
        userId: otherUserId,
        channelId,
      });

      // Verify the member was added
      const members = await t.run(async (ctx) => {
        return ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect();
      });

      expect(members).toHaveLength(2);
      const added = members.find((m) => m.userId === otherUserId);
      expect(added?.role).toBe(ChannelRole.MEMBER);
    });

    it("throws when user is already a member", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      await expect(
        asUser.mutation(api.channelMembers.addToChannel, {
          userId,
          channelId,
        }),
      ).rejects.toThrow("already a member");
    });
  });

  describe("removeFromChannel", () => {
    it("removes a member from the channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Add a second admin so we can remove the member
      const { userId: otherUserId } = await setupAuthenticatedUser(t, {
        name: "Other User",
        email: "other@example.com",
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", {
          userId: otherUserId,
          workspaceId,
          role: "member",
        });
        await ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: otherUserId,
          role: ChannelRole.MEMBER,
        });
      });

      await asUser.mutation(api.channelMembers.removeFromChannel, {
        userId: otherUserId,
        channelId,
      });

      const members = await t.run(async (ctx) => {
        return ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect();
      });

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(userId);
    });

    it("prevents removing the last admin", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      await expect(
        asUser.mutation(api.channelMembers.removeFromChannel, {
          userId,
          channelId,
        }),
      ).rejects.toThrow("Cannot remove last");
    });

    it("allows removing an admin when another admin exists", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Add a second admin
      const { userId: otherUserId } = await setupAuthenticatedUser(t, {
        name: "Other Admin",
        email: "other@example.com",
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", {
          userId: otherUserId,
          workspaceId,
          role: "member",
        });
        await ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: otherUserId,
          role: ChannelRole.ADMIN,
        });
      });

      // Should succeed — there's still one admin left
      await asUser.mutation(api.channelMembers.removeFromChannel, {
        userId,
        channelId,
      });

      const members = await t.run(async (ctx) => {
        return ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect();
      });

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(otherUserId);
    });
  });

  describe("changeMemberRole", () => {
    it("changes a member role to admin", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Add a member
      const { userId: otherUserId } = await setupAuthenticatedUser(t, {
        name: "Other User",
        email: "other@example.com",
      });
      const memberId = await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", {
          userId: otherUserId,
          workspaceId,
          role: "member",
        });
        return ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: otherUserId,
          role: ChannelRole.MEMBER,
        });
      });

      await asUser.mutation(api.channelMembers.changeMemberRole, {
        channelMemberId: memberId,
        role: ChannelRole.ADMIN,
      });

      const updated = await t.run(async (ctx) => ctx.db.get(memberId));
      expect(updated?.role).toBe(ChannelRole.ADMIN);
    });

    it("prevents demoting the last admin", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Get the admin's channel member ID
      const adminMemberId = await t.run(async (ctx) => {
        const member = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId),
          )
          .unique();
        return member!._id;
      });

      await expect(
        asUser.mutation(api.channelMembers.changeMemberRole, {
          channelMemberId: adminMemberId,
          role: ChannelRole.MEMBER,
        }),
      ).rejects.toThrow("Cannot remove last");
    });
  });
});
