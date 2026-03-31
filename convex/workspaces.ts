import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { WorkspaceRole } from "@shared/enums/roles";
import { getAll } from "convex-helpers/server/relationships";
import { logActivity } from "./auditLog";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { requireUser, getUser, requireWorkspaceMember } from "./authHelpers";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("workspaces"),
  handler: async (ctx, { name, description }) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const userId = await requireUser(ctx);

    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      description,
      ownerId: userId,
    });

    await db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: WorkspaceRole.ADMIN,
    });

    await logActivity(ctx, {
      userId, resourceType: "workspaces", resourceId: workspaceId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    return workspaceId;
  },
});

export const list = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("workspaces"),
    _creationTime: v.number(),
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
  })),
  handler: async (ctx) => {
    const userId = await getUser(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const workspaceIds = memberships.map((m) => m.workspaceId);

    // Use getAll helper to batch fetch workspaces
    const workspaces = await getAll(ctx.db, workspaceIds);
    return workspaces.filter((w): w is NonNullable<typeof w> => w !== null);
  },
});

export const get = query({
  args: { id: v.id("workspaces") },
  returns: v.union(
    v.object({
      _id: v.id("workspaces"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      ownerId: v.id("users"),
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/** Lightweight counts for the workspace overview page. */
export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    members: v.number(),
    channels: v.number(),
    projects: v.number(),
    documents: v.number(),
    diagrams: v.number(),
    spreadsheets: v.number(),
  }),
  handler: async (ctx, { workspaceId }) => {
    await requireUser(ctx);

    const [members, channels, projects, documents, diagrams, spreadsheets] =
      await Promise.all([
        ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("channels")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("projects")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("documents")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("diagrams")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
        ctx.db
          .query("spreadsheets")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
          .then((r) => r.length),
      ]);

    return { members, channels, projects, documents, diagrams, spreadsheets };
  },
});

export const update = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description }) => {
    const { userId } = await requireWorkspaceMember(ctx, id, { role: WorkspaceRole.ADMIN });

    const workspace = await ctx.db.get(id);
    if (!workspace) throw new Error("Workspace not found");

    if (name !== workspace.name) {
      await logActivity(ctx, {
        userId, resourceType: "workspaces", resourceId: id,
        action: "renamed", oldValue: workspace.name, newValue: name, resourceName: name, scope: id,
      });
    }

    await ctx.db.patch(id, {
      name,
      description,
    });
    return null;
  },
});
