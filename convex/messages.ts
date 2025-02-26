import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const channel = await ctx.db.get(channelId);
    if (!channel) throw Error(`Channel not found with id="${channelId}"`);

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership)
      throw Error(`User="${userId}" is not a member of workspace="${channel.workspaceId}"`);

    // Grab the most recent messages
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(25);

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
    isomorphicId: v.string(),
    body: v.string(),
    plainText: v.string(),
    channelId: v.id("channels"),
  },
  handler: async (ctx, { body, channelId, plainText, isomorphicId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const user: Doc<"users"> | null = await ctx.db.get(userId);

    if (!user) throw new ConvexError(`No users found with id=${userId}`);

    // Get channel to check workspace membership
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership) throw new Error("Not a member of this workspace");

    await ctx.db.insert("messages", { body, userId, channelId, plainText, isomorphicId });

    ctx.scheduler.runAfter(0, api.pushNotifications.sendPushNotification, {
      channelId,
      body: plainText,
      author: {
        name: user.name || user.email || user._id,
        id: user._id,
      },
    });
  },
});
