import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { WorkspaceRole, ChannelRole } from "@shared/enums";
import { requireWorkspaceMember } from "./authHelpers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "./dbTriggers";
import { logActivity } from "./auditLog";
import { cascadeDelete } from "./cascadeDelete";
import { internal } from "./_generated/api";

const workspaceMemberValidator = v.object({
  _id: v.id("workspaceMembers"),
  _creationTime: v.number(),
  userId: v.id("users"),
  workspaceId: v.id("workspaces"),
  role: v.union(v.literal("admin"), v.literal("member")),
});

export const byWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(workspaceMemberValidator),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    return ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const membersByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({
    _id: v.id("users"),
    _creationTime: v.number(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
  })),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return Promise.all(members.map(({ userId }) => ctx.db.get(userId))).then((users) =>
      users.filter((u) => u !== null),
    );
  },
});

export const membersWithRoles = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({
    membershipId: v.id("workspaceMembers"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    name: v.string(),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    joinedAt: v.number(),
  })),
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const results = await Promise.all(
      members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user) return null;
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          name: user.name ?? user.email ?? "Unknown",
          email: user.email,
          image: user.image,
          joinedAt: m._creationTime,
        };
      }),
    );

    return results.filter((r) => r !== null);
  },
});

export const listUserIds = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.id("users")),
  handler: async (ctx, { workspaceId }) => {
    const members = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return members.map((m) => m.userId);
  },
});

export const changeRole = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, targetUserId, role }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId, { role: WorkspaceRole.ADMIN });

    const targetMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", targetUserId),
      )
      .unique();

    if (!targetMembership) throw new ConvexError("User is not a member of this workspace");
    if (targetMembership.role === role) return null;

    // Cannot demote the last admin
    if (targetMembership.role === WorkspaceRole.ADMIN && role === WorkspaceRole.MEMBER) {
      const allAdmins = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
        .then((members) => members.filter((m) => m.role === "admin"));

      if (allAdmins.length <= 1) {
        throw new ConvexError("Cannot demote the last workspace admin");
      }
    }

    await ctx.db.patch(targetMembership._id, { role });

    await logActivity(ctx, {
      userId,
      resourceType: "workspaces",
      resourceId: workspaceId,
      action: "role_changed",
      oldValue: targetMembership.role,
      newValue: role,
      resourceName: "workspace member",
      scope: workspaceId,
    });

    return null;
  },
});

export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    targetUserId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, targetUserId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId, { role: WorkspaceRole.ADMIN });

    if (userId === targetUserId) {
      throw new ConvexError("Cannot remove yourself from the workspace");
    }

    const targetMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", targetUserId),
      )
      .unique();

    if (!targetMembership) throw new ConvexError("User is not a member of this workspace");

    // Get all channel memberships for this user in this workspace
    const channelMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", targetUserId),
      )
      .collect();

    const db = writerWithTriggers(ctx, ctx.db, triggers);

    // Handle each channel membership
    for (const cm of channelMemberships) {
      const channel = await ctx.db.get(cm.channelId);
      if (!channel) {
        await db.delete(cm._id);
        continue;
      }

      if (channel.type !== "open") {
        // Get all members of this channel
        const allMembers = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", cm.channelId))
          .collect();

        const otherMembers = allMembers.filter((m) => m.userId !== targetUserId);

        if (otherMembers.length === 0) {
          // Sole member — delete the channel entirely
          await cascadeDelete.deleteWithCascadeBatched(ctx, "channels", cm.channelId, {
            batchHandlerRef: internal.cascadeDelete._cascadeBatchHandler,
            onComplete: internal.cascadeDelete._batchCascadeOnComplete,
            onCompleteContext: {
              userId, resourceType: "channels", resourceId: cm.channelId, scope: workspaceId,
            },
          });
          continue;
        }

        if (cm.role === ChannelRole.ADMIN) {
          // Check if there are other admins
          const otherAdmins = otherMembers.filter((m) => m.role === ChannelRole.ADMIN);
          if (otherAdmins.length === 0) {
            // Promote the longest-tenured remaining member to admin
            const longestTenured = otherMembers.sort(
              (a, b) => a._creationTime - b._creationTime,
            )[0];
            await ctx.db.patch(longestTenured._id, { role: ChannelRole.ADMIN });
          }
        }
      }

      // Remove the channel membership
      await db.delete(cm._id);
    }

    // Delete the workspace membership (triggers user node cleanup)
    await db.delete(targetMembership._id);

    await logActivity(ctx, {
      userId,
      resourceType: "workspaces",
      resourceId: workspaceId,
      action: "member_removed",
      oldValue: targetUserId,
      resourceName: "workspace member",
      scope: workspaceId,
    });

    return null;
  },
});
