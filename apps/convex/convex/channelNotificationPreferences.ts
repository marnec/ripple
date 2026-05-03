import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser, getWorkspaceMembership } from "./authHelpers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "./dbTriggers";

const preferencesValidator = v.object({
  _id: v.id("channelNotificationPreferences"),
  _creationTime: v.number(),
  userId: v.id("users"),
  channelId: v.id("channels"),
  chatMention: v.boolean(),
  chatChannelMessage: v.boolean(),
});

export const get = query({
  args: { channelId: v.id("channels") },
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx, { channelId }) => {
    const userId = await requireUser(ctx);

    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    const membership = await getWorkspaceMembership(ctx, channel.workspaceId, userId);
    if (!membership) throw new ConvexError("Not a workspace member");

    return await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
      .unique();
  },
});

export const save = mutation({
  args: {
    channelId: v.id("channels"),
    chatMention: v.boolean(),
    chatChannelMessage: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { channelId, ...prefs }) => {
    const userId = await requireUser(ctx);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");

    const membership = await getWorkspaceMembership(ctx, channel.workspaceId, userId);
    if (!membership) throw new ConvexError("Not a workspace member");

    const existing = await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
      .unique();

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    if (existing) {
      await db.patch(existing._id, prefs);
    } else {
      await db.insert("channelNotificationPreferences", { userId, channelId, ...prefs });
    }

    return null;
  },
});

export const getForUsersInChannel = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    channelId: v.id("channels"),
  },
  returns: v.array(v.union(preferencesValidator, v.null())),
  handler: async (ctx, { userIds, channelId }) => {
    return await Promise.all(
      userIds.map((userId) =>
        ctx.db
          .query("channelNotificationPreferences")
          .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
          .unique(),
      ),
    );
  },
});

export const removeByChannel = internalMutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const rows = await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return null;
  },
});
