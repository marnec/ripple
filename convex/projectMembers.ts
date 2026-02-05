import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ChannelRole } from "@shared/enums";

const projectMemberValidator = v.object({
  _id: v.id("projectMembers"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  name: v.string(),
  isCreator: v.boolean(),
});

export const membersByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(projectMemberValidator),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get the project to check creatorId
    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    // Get all members
    const members = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    // Fetch user details and determine isCreator
    return Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        if (!user) return null;
        return {
          ...member,
          name: user.name ?? user.email ?? "unknown",
          isCreator: member.userId === project.creatorId,
        };
      })
    ).then((results) => results.filter((r): r is NonNullable<typeof r> => r !== null));
  },
});

export const addToProject = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
  },
  returns: v.id("projectMembers"),
  handler: async (ctx, { userId, projectId }) => {
    const requestingUserId = await getAuthUserId(ctx);
    if (!requestingUserId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    // Only project creator (admin) can add members
    if (project.creatorId !== requestingUserId) {
      throw new ConvexError("Only project creator can add members");
    }

    // Check if user to add is a workspace member
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();

    if (!workspaceMembership) {
      throw new ConvexError("User is not a member of this workspace");
    }

    // Check if user is already a project member
    const existingMembership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId)
      )
      .first();

    if (existingMembership) {
      throw new ConvexError("User is already a member of this project");
    }

    // Increment memberCount
    await ctx.db.patch(projectId, {
      memberCount: project.memberCount + 1,
    });

    // Insert project member (no role field - binary access model)
    const membershipId = await ctx.db.insert("projectMembers", {
      projectId,
      workspaceId: project.workspaceId,
      userId,
    });

    // Sync: Also add user to the linked channel
    const channelId = project.linkedChannelId;
    const channel = await ctx.db.get(channelId);

    if (channel) {
      // Check if not already a channel member
      const existingChannelMember = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();

      if (!existingChannelMember) {
        // Add to channel as member
        await ctx.db.insert("channelMembers", {
          channelId,
          userId,
          workspaceId: project.workspaceId,
          role: ChannelRole.MEMBER,
        });

        // Update channel roleCount
        await ctx.db.patch(channelId, {
          roleCount: {
            ...channel.roleCount,
            [ChannelRole.MEMBER]: channel.roleCount[ChannelRole.MEMBER] + 1,
          },
        });
      }
    }

    return membershipId;
  },
});

export const removeFromProject = mutation({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
  },
  returns: v.null(),
  handler: async (ctx, { userId, projectId }) => {
    const requestingUserId = await getAuthUserId(ctx);
    if (!requestingUserId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    // Only project creator (admin) can remove members
    if (project.creatorId !== requestingUserId) {
      throw new ConvexError("Only project creator can remove members");
    }

    // Cannot remove the creator - they must delete the project instead
    if (userId === project.creatorId) {
      throw new ConvexError(
        "Cannot remove project creator. Delete the project instead."
      );
    }

    // Members cannot remove themselves (per CONTEXT.md)
    if (userId === requestingUserId) {
      throw new ConvexError("Members cannot remove themselves from a project");
    }

    // Find the membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("User is not a member of this project");
    }

    // Decrement memberCount
    await ctx.db.patch(projectId, {
      memberCount: project.memberCount - 1,
    });

    // Delete project membership
    await ctx.db.delete(membership._id);

    // Sync: Also remove from the linked channel
    const channelId = project.linkedChannelId;
    const channel = await ctx.db.get(channelId);

    if (channel) {
      const channelMember = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();

      if (channelMember) {
        // Decrement channel roleCount
        const roleCount = channel.roleCount[channelMember.role];
        await ctx.db.patch(channelId, {
          roleCount: {
            ...channel.roleCount,
            [channelMember.role]: roleCount - 1,
          },
        });

        // Delete channel membership
        await ctx.db.delete(channelMember._id);
      }
    }

    return null;
  },
});
