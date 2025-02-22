import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, { name, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is a member of the workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (!membership) throw new Error("Not a member of this workspace");

    return await ctx.db.insert("channels", {
      name,
      workspaceId,
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
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (!membership) return [];

    return await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("channels") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("channels") },
  handler: async (ctx, { id }) => {
    const channelMessages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", id))
      .collect();

    await Promise.all(channelMessages.map((message) => ctx.db.delete(message._id)));

    await ctx.db.delete(id);
  },
});
