import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { getAll } from "convex-helpers/server/relationships";

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      userId: v.id("users"),
      isomorphicId: v.string(),
      body: v.string(),
      plainText: v.string(),
      channelId: v.id("channels"),
      deleted: v.boolean(),
      author: v.string(),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { channelId, paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

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

    // Batch fetch all users for the messages (cleaner than N+1 pattern)
    const userIds = [...new Set(messagesPage.page.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add the author's name to each message
    const messagesWithAuthor = messagesPage.page.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: user?.name ?? user?.email ?? "Unknown" };
    });

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
  returns: v.null(),
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

    await ctx.scheduler.runAfter(0, api.pushNotifications.sendPushNotification, {
      channelId,
      body: plainText,
      author: {
        name: user.name || user.email || user._id,
        id: user._id,
      },
    });
    return null;
  },
});

export const update = mutation({
  args: { id: v.id("messages"), body: v.string(), plainText: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, body, plainText }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const message = await ctx.db.get(id);
    if (!message) throw new ConvexError("Message not found");
    if (message.userId !== userId) throw new ConvexError("Not authorized to update this message");

    await ctx.db.patch(id, { body, plainText });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const message = await ctx.db.get(id);
    if (!message) throw new ConvexError("Message not found");
    if (message.userId !== userId) throw new ConvexError("Not authorized to delete this message");

    await ctx.db.patch(id, { deleted: true });
    return null;
  },
});

export const search = query({
  args: {
    channelId: v.id("channels"),
    searchTerm: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.array(v.object({
    _id: v.id("messages"),
    _creationTime: v.number(),
    userId: v.id("users"),
    isomorphicId: v.string(),
    body: v.string(),
    plainText: v.string(),
    channelId: v.id("channels"),
    deleted: v.boolean(),
    author: v.string(),
  })),
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

    // Batch fetch all users for the search results
    const userIds = [...new Set(searchResults.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add author information
    const searchResultsWithAuthor = searchResults.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: user?.name ?? user?.email ?? "Unknown" };
    });

    return searchResultsWithAuthor;
  },
});

export const getMessageContext = query({
  args: {
    messageId: v.id("messages"),
    contextSize: v.optional(v.number())
  },
  returns: v.object({
    messages: v.array(v.object({
      _id: v.id("messages"),
      _creationTime: v.number(),
      userId: v.id("users"),
      isomorphicId: v.string(),
      body: v.string(),
      plainText: v.string(),
      channelId: v.id("channels"),
      deleted: v.boolean(),
      author: v.string(),
    })),
    targetMessageId: v.id("messages"),
    targetIndex: v.number(),
  }),
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

    // Batch fetch all users for the messages
    const userIds = [...new Set(allMessages.map((m) => m.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Add author information
    const messagesWithAuthor = allMessages.map((message) => {
      const user = userMap.get(message.userId);
      return { ...message, author: user?.name ?? user?.email ?? "Unknown" };
    });

    return {
      messages: messagesWithAuthor,
      targetMessageId: messageId,
      targetIndex: messagesBefore.length // Index of the target message in the results
    };
  },
});
