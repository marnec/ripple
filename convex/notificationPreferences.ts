import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

const preferencesValidator = v.object({
  _id: v.id("notificationPreferences"),
  _creationTime: v.number(),
  userId: v.id("users"),
  chatMention: v.boolean(),
  chatChannelMessage: v.boolean(),
  taskAssigned: v.boolean(),
  taskDescriptionMention: v.boolean(),
  taskCommentMention: v.boolean(),
  taskComment: v.boolean(),
  taskStatusChange: v.boolean(),
  documentMention: v.boolean(),
  documentCreated: v.boolean(),
  documentDeleted: v.boolean(),
  spreadsheetCreated: v.boolean(),
  spreadsheetDeleted: v.boolean(),
  diagramCreated: v.boolean(),
  diagramDeleted: v.boolean(),
  projectCreated: v.boolean(),
  projectDeleted: v.boolean(),
  channelCreated: v.boolean(),
  channelDeleted: v.boolean(),
});

export const get = query({
  args: {},
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const save = mutation({
  args: {
    chatMention: v.boolean(),
    chatChannelMessage: v.boolean(),
    taskAssigned: v.boolean(),
    taskDescriptionMention: v.boolean(),
    taskCommentMention: v.boolean(),
    taskComment: v.boolean(),
    taskStatusChange: v.boolean(),
    documentMention: v.boolean(),
    documentCreated: v.boolean(),
    documentDeleted: v.boolean(),
    spreadsheetCreated: v.boolean(),
    spreadsheetDeleted: v.boolean(),
    diagramCreated: v.boolean(),
    diagramDeleted: v.boolean(),
    projectCreated: v.boolean(),
    projectDeleted: v.boolean(),
    channelCreated: v.boolean(),
    channelDeleted: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("notificationPreferences", { userId, ...args });
    }

    return null;
  },
});

export const getForUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("notificationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getForUsers = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  returns: v.array(v.union(preferencesValidator, v.null())),
  handler: async (ctx, { userIds }) => {
    return await Promise.all(
      userIds.map((userId) =>
        ctx.db
          .query("notificationPreferences")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique(),
      ),
    );
  },
});
