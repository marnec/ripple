import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError(`Unauthenticated"`);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError(`Channel not found with id="${channelId}"`);

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${channel.workspaceId}"`,
      );

    // Grab the most recent messages
    const messagesPage = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) => q.eq("channelId", channelId).eq("deleted", false))
      .order("desc")
      .paginate(paginationOpts);

    // Add the author's name to each message
    const messagesWithAuthor = await Promise.all(
      messagesPage.page.map(async (message) => {
        const { name, email } = (await ctx.db.get(message.userId))!;
        return { ...message, author: name ?? email! };
      }),
    );

    return {
      ...messagesPage,
      page: messagesWithAuthor,
    };
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
    if (!channel) throw new ConvexError("Channel not found");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    await ctx.db.insert("messages", {
      body,
      userId,
      channelId,
      plainText,
      isomorphicId,
      deleted: false,
    });

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

export const update = mutation({
  args: { id: v.id("messages"), body: v.string(), plainText: v.string() },
  handler: async (ctx, { id, body, plainText }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    return ctx.db.patch(id, { body, plainText });
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    return ctx.db.patch(id, { deleted: true });
  },
});

export const search = query({
  args: { 
    channelId: v.id("channels"), 
    searchTerm: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, { channelId, searchTerm, limit = 20 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError(`Unauthenticated`);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError(`Channel not found with id="${channelId}"`);

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(
        `User="${userId}" is not a member of workspace="${channel.workspaceId}"`,
      );

    // Search for messages
    const searchResults = await ctx.db
      .query("messages")
      .withSearchIndex("by_text", (q) => 
        q.search("plainText", searchTerm).eq("channelId", channelId)
      )
      .take(limit);

    // Add author information
    const searchResultsWithAuthor = await Promise.all(
      searchResults.map(async (message) => {
        const { name, email } = (await ctx.db.get(message.userId))!;
        return { ...message, author: name ?? email! };
      }),
    );

    return searchResultsWithAuthor;
  },
});

export const getMessageContext = query({
  args: { 
    messageId: v.id("messages"),
    contextSize: v.optional(v.number())
  },
  handler: async (ctx, { messageId, contextSize = 10 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError(`Unauthenticated`);

    const targetMessage = await ctx.db.get(messageId);
    if (!targetMessage) throw new ConvexError(`Message not found`);

    const channel = await ctx.db.get(targetMessage.channelId);
    if (!channel) throw new ConvexError(`Channel not found`);

    // Check workspace membership
    const workspaceMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", channel.workspaceId).eq("userId", userId),
      )
      .first();

    if (!workspaceMembership)
      throw new ConvexError(`User not authorized`);

    // Get messages before and after the target message
    const messagesBefore = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) => 
        q.eq("channelId", targetMessage.channelId).eq("deleted", false)
      )
      .filter((q) => q.lt(q.field("_creationTime"), targetMessage._creationTime))
      .order("desc")
      .take(contextSize);

    const messagesAfter = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) => 
        q.eq("channelId", targetMessage.channelId).eq("deleted", false)
      )
      .filter((q) => q.gt(q.field("_creationTime"), targetMessage._creationTime))
      .order("asc")
      .take(contextSize);

    // Combine and sort all messages
    const allMessages = [...messagesBefore.reverse(), targetMessage, ...messagesAfter];

    // Add author information
    const messagesWithAuthor = await Promise.all(
      allMessages.map(async (message) => {
        const { name, email } = (await ctx.db.get(message.userId))!;
        return { ...message, author: name ?? email! };
      }),
    );

    return {
      messages: messagesWithAuthor,
      targetMessageId: messageId,
      targetIndex: messagesBefore.length // Index of the target message in the results
    };
  },
});
