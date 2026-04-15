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
      type: "closed" as const,
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

/** Create a public channel (no channel membership needed for workspace members). */
async function setupPublicChannel(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; name?: string },
) {
  const { workspaceId, name = "public-channel" } = opts;
  return await t.run(async (ctx) => {
    return ctx.db.insert("channels", {
      name,
      workspaceId,
      type: "open" as const,
    });
  });
}

/** Add a user to the workspace with the given role. */
async function addWorkspaceMember(
  t: ReturnType<typeof createTestContext>,
  opts: { userId: Id<"users">; workspaceId: Id<"workspaces">; role?: string },
) {
  const { userId, workspaceId, role = "member" } = opts;
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId,
      role: role as "admin" | "member",
    });
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

      await addWorkspaceMember(t, { userId: otherUserId, workspaceId });

      await asUser.mutation(api.channelMembers.addToChannel, {
        userId: otherUserId,
        channelId,
      });

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

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      await expect(
        t.mutation(api.channelMembers.addToChannel, {
          userId,
          channelId,
        }),
      ).rejects.toThrow("Not authenticated");
    });

    it("rejects non-admin caller on private channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Create a regular channel member
      const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
        name: "Member",
        email: "member@example.com",
      });
      await addWorkspaceMember(t, { userId: memberId, workspaceId });
      await t.run(async (ctx) => {
        await ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: memberId,
          role: ChannelRole.MEMBER,
        });
      });

      // Create a target user to add
      const { userId: targetId } = await setupAuthenticatedUser(t, {
        name: "Target",
        email: "target@example.com",
      });
      await addWorkspaceMember(t, { userId: targetId, workspaceId });

      await expect(
        asMember.mutation(api.channelMembers.addToChannel, {
          userId: targetId,
          channelId,
        }),
      ).rejects.toThrow("Not authorized");
    });

    it("rejects adding a user not in the workspace", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      const { userId: outsiderId } = await setupAuthenticatedUser(t, {
        name: "Outsider",
        email: "outsider@example.com",
      });

      await expect(
        asUser.mutation(api.channelMembers.addToChannel, {
          userId: outsiderId,
          channelId,
        }),
      ).rejects.toThrow("not a member of this workspace");
    });

    it("allows workspace member to add to public channel", async () => {
      const t = createTestContext();
      const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPublicChannel(t, { workspaceId });

      const { userId: targetId } = await setupAuthenticatedUser(t, {
        name: "Target",
        email: "target@example.com",
      });
      await addWorkspaceMember(t, { userId: targetId, workspaceId });

      await asUser.mutation(api.channelMembers.addToChannel, {
        userId: targetId,
        channelId,
      });

      const members = await t.run(async (ctx) => {
        return ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect();
      });
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(targetId);
    });
  });

  describe("removeFromChannel", () => {
    it("removes a member from the channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

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

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      await expect(
        t.mutation(api.channelMembers.removeFromChannel, {
          userId,
          channelId,
        }),
      ).rejects.toThrow("Not authenticated");
    });

    it("rejects non-admin removing another user from private channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Add two regular members
      const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
        name: "Member",
        email: "member@example.com",
      });
      const { userId: targetId } = await setupAuthenticatedUser(t, {
        name: "Target",
        email: "target@example.com",
      });
      await t.run(async (ctx) => {
        for (const uid of [memberId, targetId]) {
          await ctx.db.insert("workspaceMembers", { userId: uid, workspaceId, role: "member" });
          await ctx.db.insert("channelMembers", { channelId, workspaceId, userId: uid, role: ChannelRole.MEMBER });
        }
      });

      await expect(
        asMember.mutation(api.channelMembers.removeFromChannel, {
          userId: targetId,
          channelId,
        }),
      ).rejects.toThrow("Not authorized");
    });

    it("allows self-removal from channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
        name: "Member",
        email: "member@example.com",
      });
      await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", { userId: memberId, workspaceId, role: "member" });
        await ctx.db.insert("channelMembers", { channelId, workspaceId, userId: memberId, role: ChannelRole.MEMBER });
      });

      await asMember.mutation(api.channelMembers.removeFromChannel, {
        userId: memberId,
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
  });

  describe("changeMemberRole", () => {
    it("changes a member role to admin", async () => {
      const t = createTestContext();
      const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

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

    it("rejects unauthenticated caller", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      const memberId = await t.run(async (ctx) => {
        const member = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId),
          )
          .unique();
        return member!._id;
      });

      await expect(
        t.mutation(api.channelMembers.changeMemberRole, {
          channelMemberId: memberId,
          role: ChannelRole.MEMBER,
        }),
      ).rejects.toThrow("Not authenticated");
    });

    it("rejects non-admin caller on private channel", async () => {
      const t = createTestContext();
      const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
      const channelId = await setupPrivateChannel(t, { workspaceId, userId });

      // Add a regular member
      const { userId: memberId, asUser: asMember } = await setupAuthenticatedUser(t, {
        name: "Member",
        email: "member@example.com",
      });
      const channelMemberId = await t.run(async (ctx) => {
        await ctx.db.insert("workspaceMembers", { userId: memberId, workspaceId, role: "member" });
        return ctx.db.insert("channelMembers", {
          channelId,
          workspaceId,
          userId: memberId,
          role: ChannelRole.MEMBER,
        });
      });

      await expect(
        asMember.mutation(api.channelMembers.changeMemberRole, {
          channelMemberId,
          role: ChannelRole.ADMIN,
        }),
      ).rejects.toThrow("Not authorized");
    });
  });
});
