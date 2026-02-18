import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(v.any()),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate user is workspace member (via project)
    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Query with by_project_order index, sorted by order
    const statuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
      .collect();

    return statuses;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    isCompleted: v.boolean(),
  },
  returns: v.id("taskStatuses"),
  handler: async (ctx, { projectId, name, color, isCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Permission: must be workspace member (via project)
    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Calculate next order number (max existing order + 1)
    const existingStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const maxOrder = existingStatuses.reduce((max, status) => Math.max(max, status.order), -1);

    // isDefault always false for user-created statuses
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
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

    // Permission: must be workspace member (via project)
    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
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

export const reorderColumns = mutation({
  args: {
    statusIds: v.array(v.id("taskStatuses")),
  },
  returns: v.null(),
  handler: async (ctx, { statusIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate all statuses exist and belong to same project
    if (statusIds.length === 0) return null;

    const firstStatus = await ctx.db.get(statusIds[0]);
    if (!firstStatus) throw new ConvexError("Status not found");

    // Permission check: must be workspace member (via project)
    const project = await ctx.db.get(firstStatus.projectId);
    if (!project) throw new ConvexError("Project not found");
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Reassign order values sequentially
    for (let i = 0; i < statusIds.length; i++) {
      await ctx.db.patch(statusIds[i], { order: i });
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

    // Permission: must be workspace member (via project)
    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Cannot remove if it's the default status
    if (status.isDefault) {
      throw new ConvexError("Cannot remove the default status");
    }

    // Find the default status for this project
    const defaultStatus = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", status.projectId))
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    if (!defaultStatus) {
      throw new ConvexError("No default status found for project");
    }

    // Cascade: move all tasks using this status to the default status
    const tasksToMove = await ctx.db
      .query("tasks")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", status.projectId).eq("statusId", statusId)
      )
      .collect();

    // Move tasks to default status (preserve completed field - don't change it)
    await Promise.all(
      tasksToMove.map((task) =>
        ctx.db.patch(task._id, { statusId: defaultStatus._id })
      )
    );

    // Delete the status
    await ctx.db.delete(statusId);
    return null;
  },
});
