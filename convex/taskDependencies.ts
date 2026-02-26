import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { insertActivity } from "./taskActivity";

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  returns: v.any(),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { blocks: [], blockedBy: [], relatesTo: [] };

    const task = await ctx.db.get(taskId);
    if (!task) return { blocks: [], blockedBy: [], relatesTo: [] };

    // Auth: workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return { blocks: [], blockedBy: [], relatesTo: [] };

    // Query outgoing (taskId = this task)
    const outgoing = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();

    // Query incoming (dependsOnTaskId = this task)
    const incoming = await ctx.db
      .query("taskDependencies")
      .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", taskId))
      .collect();

    // Enrich helper
    const enrichTask = async (id: typeof taskId) => {
      const t = await ctx.db.get(id);
      if (!t) return null;
      const project = await ctx.db.get(t.projectId);
      return {
        _id: t._id,
        title: t.title,
        number: t.number,
        projectKey: project?.key,
        completed: t.completed,
      };
    };

    const blocks: any[] = [];
    const blockedBy: any[] = [];
    const relatesTo: any[] = [];

    for (const dep of outgoing) {
      const enriched = await enrichTask(dep.dependsOnTaskId);
      if (!enriched) continue;
      const item = { dependencyId: dep._id, task: enriched };
      if (dep.type === "blocks") {
        blocks.push(item);
      } else {
        relatesTo.push(item);
      }
    }

    for (const dep of incoming) {
      const enriched = await enrichTask(dep.taskId);
      if (!enriched) continue;
      const item = { dependencyId: dep._id, task: enriched };
      if (dep.type === "blocks") {
        blockedBy.push(item);
      } else {
        // Only add relates_to from incoming if not already added from outgoing
        const alreadyAdded = relatesTo.some((r) => r.task._id === dep.taskId);
        if (!alreadyAdded) {
          relatesTo.push(item);
        }
      }
    }

    return { blocks, blockedBy, relatesTo };
  },
});

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    dependsOnTaskId: v.id("tasks"),
    type: v.union(v.literal("blocks"), v.literal("relates_to")),
  },
  returns: v.id("taskDependencies"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Prevent self-reference
    if (args.taskId === args.dependsOnTaskId) {
      throw new ConvexError("A task cannot depend on itself");
    }

    // Auth: check workspace membership via source task
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Task not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Check for duplicate (same direction)
    const existing = await ctx.db
      .query("taskDependencies")
      .withIndex("by_pair", (q) =>
        q.eq("taskId", args.taskId).eq("dependsOnTaskId", args.dependsOnTaskId)
      )
      .first();
    if (existing) throw new ConvexError("Dependency already exists");

    // For relates_to, also check reverse direction
    if (args.type === "relates_to") {
      const reverse = await ctx.db
        .query("taskDependencies")
        .withIndex("by_pair", (q) =>
          q.eq("taskId", args.dependsOnTaskId).eq("dependsOnTaskId", args.taskId)
        )
        .first();
      if (reverse) throw new ConvexError("Relationship already exists");
    }

    const depId = await ctx.db.insert("taskDependencies", {
      ...args,
      creatorId: userId,
    });

    // Log activity
    const targetTask = await ctx.db.get(args.dependsOnTaskId);
    await insertActivity(ctx, {
      taskId: args.taskId,
      userId,
      type: "dependency_add",
      newValue: `${args.type}:${targetTask?.title ?? "Unknown"}`,
    });

    return depId;
  },
});

export const remove = mutation({
  args: { dependencyId: v.id("taskDependencies") },
  returns: v.null(),
  handler: async (ctx, { dependencyId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const dep = await ctx.db.get(dependencyId);
    if (!dep) throw new ConvexError("Dependency not found");

    // Auth via source task's workspace
    const task = await ctx.db.get(dep.taskId);
    if (!task) throw new ConvexError("Task not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Log activity before deleting
    const targetTask = await ctx.db.get(dep.dependsOnTaskId);
    await insertActivity(ctx, {
      taskId: dep.taskId,
      userId,
      type: "dependency_remove",
      oldValue: `${dep.type}:${targetTask?.title ?? "Unknown"}`,
    });

    await ctx.db.delete(dependencyId);
    return null;
  },
});
