import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: { 
    name: v.string(),
    description: v.optional(v.string()) 
  },
  handler: async (ctx, { name, description }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    
    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      description,
      ownerId: userId,
    });

    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "admin",
    });

    return workspaceId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.eq(q.field("userId"), userId))
      .collect();

    const workspaceIds = memberships.map(m => m.workspaceId);
    
    return await Promise.all(
      workspaceIds.map(async (id) => {
        const workspace = await ctx.db.get(id);
        return workspace!;
      })
    );
  },
});