import { ChannelRole } from "@shared/enums";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ChannelMember } from "@shared/types/channel";
import { getUserDisplayName } from "@shared/displayName";
import { channelRoleSchema } from "./schema";
import { logActivity } from "./auditLog";
import { requireUser } from "./authHelpers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "./dbTriggers";

const channelMemberValidator = v.object({
  _id: v.id("channelMembers"),
  _creationTime: v.number(),
  channelId: v.id("channels"),
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  role: v.union(v.literal("admin"), v.literal("member")),
});

export const byChannel = query({
  args: { channelId: v.id("channels") },
  returns: v.array(channelMemberValidator),
  handler: async (ctx, { channelId }) => {
    await requireUser(ctx);

    return ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
  },
});

export const membersByChannel = query({
  args: { channelId: v.id("channels") },
  returns: v.array(v.object({
    _id: v.id("channelMembers"),
    _creationTime: v.number(),
    channelId: v.id("channels"),
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
    name: v.string(),
    email: v.optional(v.string()),
    lastReadAt: v.optional(v.number()),
  })),
  handler: async (ctx, { channelId }) => {
    await requireUser(ctx);

    const members = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();

    return members.map((member) => ({
      ...member,
      name: member.name ?? member.email ?? "Unknown",
    } satisfies ChannelMember));
  },
});

export const addToChannel = mutation({
  args: { userId: v.id("users"), channelId: v.id("channels") },
  returns: v.id("channelMembers"),
  handler: async (ctx, { userId, channelId }) => {
    const callerId = await requireUser(ctx);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError(`Channel ${channelId} does not exist`);

    // Caller must be channel admin (closed/dm) or workspace member (open)
    if (channel.type !== "open") {
      if (channel.type === "dm") {
        throw new ConvexError("Cannot add members to a DM");
      }
      const callerMembership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", callerId))
        .first();
      if (callerMembership?.role !== ChannelRole.ADMIN) {
        throw new ConvexError("Not authorized to add members to this channel");
      }
    } else {
      const workspaceMembership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", callerId))
        .first();
      if (!workspaceMembership) {
        throw new ConvexError("Not authorized to add members to this channel");
      }
    }

    // Target user must be in the workspace
    const targetWorkspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", userId))
      .first();
    if (!targetWorkspaceMembership) {
      throw new ConvexError("User is not a member of this workspace");
    }

    const channelMemberExists = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    if (channelMemberExists) {
      throw new ConvexError(`User id=${userId} is already a member of channel id=${channelId}`);
    }

    const targetUser = await ctx.db.get(userId);

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const memberId = await db.insert("channelMembers", {
      userId,
      channelId,
      workspaceId: channel.workspaceId,
      role: ChannelRole.MEMBER,
      email: targetUser?.email,
      name: targetUser ? getUserDisplayName(targetUser) : undefined,
    });

    // Auto-approve any pending join request for this user/channel
    const pendingRequest = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_user_status", (q) =>
        q.eq("channelId", channelId).eq("userId", userId).eq("status", "pending"),
      )
      .first();
    if (pendingRequest) {
      await ctx.db.patch(pendingRequest._id, {
        status: "approved",
        decidedBy: callerId,
        decidedAt: Date.now(),
      });
    }

    await logActivity(ctx, {
      userId: callerId, resourceType: "channelMembers", resourceId: channelId,
      action: "member_added", newValue: userId, resourceName: channel.name, scope: channel.workspaceId,
    });

    return memberId;
  },
});

export const removeFromChannel = mutation({
  args: { userId: v.id("users"), channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { userId, channelId }) => {
    const callerId = await requireUser(ctx);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");

    // Allow self-removal, otherwise require channel admin (closed) or workspace admin (open)
    const isSelfRemoval = callerId === userId;
    if (!isSelfRemoval) {
      if (channel.type === "dm") {
        throw new ConvexError("Cannot remove members from a DM");
      }
      if (channel.type !== "open") {
        const callerMembership = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", callerId))
          .first();
        if (callerMembership?.role !== ChannelRole.ADMIN) {
          throw new ConvexError("Not authorized to remove members from this channel");
        }
      } else {
        const workspaceMembership = await ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", callerId))
          .first();
        if (workspaceMembership?.role !== "admin") {
          throw new ConvexError("Not authorized to remove members from this channel");
        }
      }
    }

    const channelMember = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    if (!channelMember) {
      throw new ConvexError(`User id=${userId} is not part of channel id=${channelId}`);
    }

    if (channelMember.role === ChannelRole.ADMIN) {
      const channelAdmins = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_role", (q) =>
          q.eq("channelId", channelId).eq("role", "admin"),
        )
        .collect();

      if (channelAdmins.length <= 1) {
        throw new ConvexError(
          `Cannot remove last ${ChannelRole.ADMIN} in the channel, set another user as admin first`,
        );
      }
    }

    await logActivity(ctx, {
      userId: callerId, resourceType: "channelMembers", resourceId: channelId,
      action: "member_removed", oldValue: userId, resourceName: channel.name, scope: channel.workspaceId,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.delete(channelMember._id);
    return null;
  },
});

export const changeMemberRole = mutation({
  args: { channelMemberId: v.id("channelMembers"), role: channelRoleSchema },
  returns: v.null(),
  handler: async (ctx, { channelMemberId, role }) => {
    const callerId = await requireUser(ctx);

    const channelMember = await ctx.db.get(channelMemberId);
    if (!channelMember) {
      throw new ConvexError(`No channel member found with id=${channelMemberId}`);
    }

    const channel = await ctx.db.get(channelMember.channelId);
    if (!channel) throw new ConvexError("Channel not found");

    // Caller must be channel admin (closed) or workspace admin (open). DMs have no role changes.
    if (channel.type === "dm") {
      throw new ConvexError("Cannot change roles in a DM");
    }
    if (channel.type !== "open") {
      const callerMembership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", callerId))
        .first();
      if (callerMembership?.role !== ChannelRole.ADMIN) {
        throw new ConvexError("Not authorized to change member roles");
      }
    } else {
      const workspaceMembership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", callerId))
        .first();
      if (workspaceMembership?.role !== "admin") {
        throw new ConvexError("Not authorized to change member roles");
      }
    }

    if (channelMember.role === role) return null;

    if (channelMember.role === "admin") {
      const channelAdmins = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_role", (q) =>
          q.eq("channelId", channelMember.channelId).eq("role", "admin"),
        )
        .collect();

      if (channelAdmins.length <= 1) {
        throw new ConvexError(
          `Cannot remove last ${ChannelRole.ADMIN} in the channel, set another user as admin first`,
        );
      }
    }

    await logActivity(ctx, {
      userId: callerId, resourceType: "channelMembers", resourceId: channelMember.channelId,
      action: "role_changed", oldValue: channelMember.role, newValue: role, resourceName: channel.name, scope: channel.workspaceId,
    });

    await ctx.db.patch(channelMemberId, { role });
    return null;
  },
});
