import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ChannelRole, WorkspaceRole } from "@shared/enums";
import { getAll } from "convex-helpers/server/relationships";
import { stream } from "convex-helpers/server/stream";
import schema from "./schema";

const projectValidator = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  color: v.string(),
  workspaceId: v.id("workspaces"),
  linkedChannelId: v.id("channels"),
  creatorId: v.id("users"),
  memberCount: v.number(),
});

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    workspaceId: v.id("workspaces"),
  },
  returns: v.id("projects"),
  handler: async (ctx, { name, color, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check if user is a workspace admin
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");
    if (membership.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Only workspace admins can create projects");
    }

    // Create the linked channel first (private by default)
    const channelId = await ctx.db.insert("channels", {
      name: `${name} Discussion`,
      workspaceId,
      isPublic: false,
      roleCount: {
        [ChannelRole.MEMBER]: 0,
        [ChannelRole.ADMIN]: 1,
      },
    });

    // Add creator to channel as admin
    await ctx.db.insert("channelMembers", {
      channelId,
      userId,
      role: ChannelRole.ADMIN,
      workspaceId,
    });

    // Create the project with linked channel
    const projectId = await ctx.db.insert("projects", {
      name,
      color,
      workspaceId,
      linkedChannelId: channelId,
      creatorId: userId,
      memberCount: 1,
    });

    // Add creator as project member (no role field - binary access model)
    await ctx.db.insert("projectMembers", {
      projectId,
      workspaceId,
      userId,
    });

    // Seed default task statuses for this project
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
    });

    return projectId;
  },
});

export const get = query({
  args: { id: v.id("projects") },
  returns: v.union(projectValidator, v.null()),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const project = await ctx.db.get(id);
    if (!project) return null;

    // Check user has project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", id).eq("userId", userId)
      )
      .first();

    if (!membership) return null;

    return project;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(projectValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Check workspace membership first
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) return [];

    // Return all projects in workspace (for admin views)
    return await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(projectValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get user's project memberships in this workspace
    const userMemberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .collect();

    // Use getAll helper to batch fetch projects
    const projectIds = userMemberships.map((m) => m.projectId);
    const projects = (await getAll(ctx.db, projectIds)).filter(
      (p): p is NonNullable<typeof p> => p !== null
    );

    // Sort alphabetically by name (per CONTEXT.md decision)
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description, color }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");

    // Only creator can update project
    if (project.creatorId !== userId) {
      throw new ConvexError("Only project creator can update the project");
    }

    // Build patch object with only provided fields
    const patch: { name?: string; description?: string; color?: string } = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (color !== undefined) patch.color = color;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
    }

    // If name changed, also update linked channel name
    if (name !== undefined) {
      await ctx.db.patch(project.linkedChannelId, {
        name: `${name} Discussion`,
      });
    }

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");

    // Only creator can delete project
    if (project.creatorId !== userId) {
      throw new ConvexError("Only project creator can delete the project");
    }

    // Delete all project members
    const projectMembersStream = stream(ctx.db, schema)
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", id));

    await projectMembersStream
      .map(async (doc) => {
        await ctx.db.delete(doc._id);
        return null;
      })
      .collect();

    // Cascade delete: tasks, taskComments, and taskStatuses
    // 1. Delete all taskComments for tasks in this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();

    await Promise.all(
      tasks.map(async (task) => {
        const taskComments = await ctx.db
          .query("taskComments")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        await Promise.all(taskComments.map((comment) => ctx.db.delete(comment._id)));
      })
    );

    // 2. Delete all tasks in the project
    await Promise.all(tasks.map((task) => ctx.db.delete(task._id)));

    // 3. Delete all taskStatuses for the project
    const taskStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    await Promise.all(taskStatuses.map((status) => ctx.db.delete(status._id)));

    // Delete linked channel (messages and channel members first)
    const channelId = project.linkedChannelId;

    // Delete channel messages
    const channelMessages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    await Promise.all(channelMessages.map((message) => ctx.db.delete(message._id)));

    // Delete channel members
    const channelMembersStream = stream(ctx.db, schema)
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId));

    await channelMembersStream
      .map(async (doc) => {
        await ctx.db.delete(doc._id);
        return null;
      })
      .collect();

    // Delete the channel
    await ctx.db.delete(channelId);

    // Delete the project
    await ctx.db.delete(id);

    return null;
  },
});

export const getByLinkedChannel = query({
  args: { channelId: v.id("channels") },
  returns: v.union(projectValidator, v.null()),
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Get channel to find workspace
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    // Find project that has this channel as linked channel
    // Projects per workspace are small (<100), so filter is acceptable
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", channel.workspaceId))
      .collect();

    const project = projects.find((p) => p.linkedChannelId === channelId);
    if (!project) return null;

    // Verify user has project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", project._id).eq("userId", userId)
      )
      .first();

    if (!membership) return null;

    return project;
  },
});
