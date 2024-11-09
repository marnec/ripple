import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get channel to check workspace membership
    const channel = await ctx.db.get(channelId);
    if (!channel) return [];

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.and(
        q.eq(q.field("userId"), userId),
        q.eq(q.field("workspaceId"), channel.workspaceId)
      ))
      .first();

    if (!membership) return [];

    // Grab the most recent messages
    const messages = await ctx.db
      .query("messages")
      .filter(q => q.eq(q.field("channelId"), channelId))
      .order("desc")
      .take(100);

    // Add the author's name to each message
    return Promise.all(
      messages.map(async (message) => {
        const { name, email } = (await ctx.db.get(message.userId))!;
        return { ...message, author: name ?? email! };
      }),
    );
  },
});

export const send = mutation({
  args: {
    body: v.string(),
    channelId: v.id("channels"),
  },
  handler: async (ctx, { body, channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get channel to check workspace membership
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .filter(q => q.and(
        q.eq(q.field("userId"), userId),
        q.eq(q.field("workspaceId"), channel.workspaceId)
      ))
      .first();

    if (!membership) throw new Error("Not a member of this workspace");

    await ctx.db.insert("messages", { body, userId, channelId });
  },
});
