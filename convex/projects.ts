import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { WorkspaceRole } from "@shared/enums";

const projectValidator = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  name: v.string(),
  description: v.optional(v.string()),
  color: v.string(),
  workspaceId: v.id("workspaces"),
  creatorId: v.id("users"),
  key: v.optional(v.string()),
  taskCounter: v.optional(v.number()),
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

    // Auto-generate a unique project key from the name
    const baseKey = name
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 3)
      .toUpperCase() || "PRJ";

    let key = baseKey;
    let suffix = 1;
    while (true) {
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_workspace_key", (q) =>
          q.eq("workspaceId", workspaceId).eq("key", key)
        )
        .first();
      if (!existing) break;
      key = `${baseKey}${suffix}`;
      suffix++;
    }

    // Create the project
    const projectId = await ctx.db.insert("projects", {
      name,
      color,
      workspaceId,
      creatorId: userId,
      key,
      taskCounter: 0,
    });

    // Seed default task statuses for this project
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
      setsStartDate: false,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
      setsStartDate: true,
    });

    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
      setsStartDate: false,
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

    // Check user has workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
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

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    key: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description, color, key }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");

    // Only creator can update project
    if (project.creatorId !== userId) {
      throw new ConvexError("Only project creator can update the project");
    }

    // Build patch object with only provided fields
    const patch: { name?: string; description?: string; color?: string; key?: string } = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (color !== undefined) patch.color = color;

    // Validate and set project key
    if (key !== undefined) {
      const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (normalized.length < 2 || normalized.length > 5) {
        throw new ConvexError("Project key must be 2-5 alphanumeric characters");
      }
      // Check uniqueness within workspace
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_workspace_key", (q) =>
          q.eq("workspaceId", project.workspaceId).eq("key", normalized)
        )
        .first();
      if (existing && existing._id !== id) {
        throw new ConvexError("Project key already in use");
      }
      patch.key = normalized;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch);
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

    // 2. Clean up task dependencies, Yjs snapshots, and delete tasks
    await Promise.all(
      tasks.map(async (task) => {
        // Delete dependencies (both directions)
        const outDeps = await ctx.db
          .query("taskDependencies")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        const inDeps = await ctx.db
          .query("taskDependencies")
          .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", task._id))
          .collect();
        await Promise.all([...outDeps, ...inDeps].map((d) => ctx.db.delete(d._id)));

        if (task.yjsSnapshotId) {
          await ctx.storage.delete(task.yjsSnapshotId);
        }
        await ctx.db.delete(task._id);
      })
    );

    // 3. Delete all taskStatuses for the project
    const taskStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    await Promise.all(taskStatuses.map((status) => ctx.db.delete(status._id)));

    // Delete the project
    await ctx.db.delete(id);

    return null;
  },
});
