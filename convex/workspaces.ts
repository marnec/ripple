import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { WorkspaceRole } from "@shared/enums/roles";
import { getAll } from "convex-helpers/server/relationships";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("workspaces"),
  handler: async (ctx, { name, description }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      description,
      ownerId: userId,
    });

    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: WorkspaceRole.ADMIN,
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
    const userId = await getAuthUserId(ctx);
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

export const update = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const workspace = await ctx.db.get(id);
    if (!workspace) throw new ConvexError("Workspace not found");

    // Check if user is admin of workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", id).eq("userId", userId))
      .first();

    if (membership?.role !== WorkspaceRole.ADMIN) {
      throw new ConvexError("Not authorized to update this workspace");
    }

    await ctx.db.patch(id, {
      name,
      description,
    });
    return null;
  },
});
