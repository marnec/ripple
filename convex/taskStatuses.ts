import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const seedDefaultStatuses = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    // Check if statuses already exist for workspace
    const existingStatus = await ctx.db
      .query("taskStatuses")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();

    if (existingStatus) return null; // Already seeded

    // Insert 3 default statuses
    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "To Do",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
    });

    await ctx.db.insert("taskStatuses", {
      workspaceId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
    });

    return null;
  },
});

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.any()),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate user is workspace member
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Query with by_workspace_order index, sorted by order
    const statuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_workspace_order", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return statuses;
  },
});

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    color: v.string(),
    isCompleted: v.boolean(),
  },
  returns: v.id("taskStatuses"),
  handler: async (ctx, { workspaceId, name, color, isCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Permission: must be workspace member
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Calculate next order number (max existing order + 1)
    const existingStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const maxOrder = existingStatuses.reduce((max, status) => Math.max(max, status.order), -1);

    // isDefault always false for user-created statuses
    const statusId = await ctx.db.insert("taskStatuses", {
      workspaceId,
      name,
      color,
      order: maxOrder + 1,
      isDefault: false,
      isCompleted,
    });

    return statusId;
  },
});

export const update = mutation({
  args: {
    statusId: v.id("taskStatuses"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { statusId, name, color, order }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    // Permission: must be workspace member
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", status.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Build patch object with only provided fields
    const patch: { name?: string; color?: string; order?: number } = {};
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    if (order !== undefined) patch.order = order;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(statusId, patch);
    }

    return null;
  },
});

export const remove = mutation({
  args: { statusId: v.id("taskStatuses") },
  returns: v.null(),
  handler: async (ctx, { statusId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    // Permission: must be workspace member
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", status.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Cannot remove if it's the default status
    if (status.isDefault) {
      throw new ConvexError("Cannot remove the default status");
    }

    // Cannot remove if tasks are currently using this status
    const tasksUsingStatus = await ctx.db
      .query("tasks")
      .withIndex("by_project_status", (q) => q.eq("statusId", statusId))
      .first();

    if (tasksUsingStatus) {
      throw new ConvexError("Cannot remove status that is being used by tasks");
    }

    await ctx.db.delete(statusId);
    return null;
  },
});
