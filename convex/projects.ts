import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { WorkspaceRole } from "@shared/enums";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { internal } from "./_generated/api";
import { triggers } from "./workspaceAggregates";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";

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
  tags: v.optional(v.array(v.string())),
});

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
    workspaceId: v.id("workspaces"),
    key: v.optional(v.string()),
  },
  returns: v.id("projects"),
  handler: async (ctx, { name, color, workspaceId, key: providedKey }) => {
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

    // Use provided key or auto-generate from name
    const baseKey = (providedKey
      ? providedKey.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5)
      : name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()
    ) || "PRJ";

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
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const projectId = await db.insert("projects", {
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

    await logActivity(ctx, {
      userId, resourceType: "projects", resourceId: projectId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId,
      resourceType: "project",
      resourceName: name,
      event: "created",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
      url: `/workspaces/${workspaceId}/projects/${projectId}`,
    });

    return projectId;
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isFavorite: v.optional(v.boolean()),
  },
  returns: v.array(projectValidator),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("projects")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("projects")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
    }

    if (tags && tags.length > 0) {
      results = results.filter(
        (p) => p.tags && tags.every((t) => p.tags!.includes(t)),
      );
    }

    if (isFavorite !== undefined) {
      const favs = await ctx.db
        .query("favorites")
        .withIndex("by_workspace_user_type", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", "project"),
        )
        .collect();
      const favSet = new Set(favs.map((f) => f.resourceId));
      results = isFavorite
        ? results.filter((p) => favSet.has(p._id))
        : results.filter((p) => !favSet.has(p._id));
    }

    return results;
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
    tags: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description, color, key, tags }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");

    // Only creator can update project
    if (project.creatorId !== userId) {
      throw new ConvexError("Only project creator can update the project");
    }

    // Build patch object with only provided fields
    const patch: { name?: string; description?: string; color?: string; key?: string; tags?: string[] } = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (color !== undefined) patch.color = color;
    if (tags !== undefined) patch.tags = tags;

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
      if (name !== undefined && name !== project.name) {
        await logActivity(ctx, {
          userId, resourceType: "projects", resourceId: id,
          action: "renamed", oldValue: project.name, newValue: name, resourceName: name, scope: project.workspaceId,
        });
      }
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.patch(id, patch);
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

    await logActivity(ctx, {
      userId, resourceType: "projects", resourceId: id,
      action: "deleted", oldValue: project.name, resourceName: project.name, scope: project.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId: project.workspaceId,
      resourceType: "project",
      resourceName: project.name,
      event: "deleted",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
    });

    await cascadeDelete.deleteWithCascade(ctx, "projects", id, {
      onComplete: logCascadeSummary({
        userId, resourceType: "projects", resourceId: id, scope: project.workspaceId,
      }),
    });

    return null;
  },
});
