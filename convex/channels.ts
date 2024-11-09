import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: { 
    name: v.string(),
    workspaceId: v.id("workspaces")
  },
  handler: async (ctx, { name, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    
    // Check if user is a member of the workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.and(
        q.eq(q.field("userId"), userId),
        q.eq(q.field("workspaceId"), workspaceId)
      ))
      .first();
    
    if (!membership) throw new Error("Not a member of this workspace");

    return await ctx.db.insert("channels", {
      name,
      workspaceId
    });
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Check if user is a member of the workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.and(
        q.eq(q.field("userId"), userId),
        q.eq(q.field("workspaceId"), workspaceId)
      ))
      .first();
    
    if (!membership) return [];

    return await ctx.db
      .query("channels")
      .filter(q => q.eq(q.field("workspaceId"), workspaceId))
      .collect();
  },
});
