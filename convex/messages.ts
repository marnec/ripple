import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";

const sendPushNotificationRef = makeFunctionReference<
  "action",
  { channelId: Id<"channels">; body: string; author: { name: string; id: Id<"users"> } },
  null
>("pushNotifications:sendPushNotification");

const notifyMessageMentionsRef = makeFunctionReference<
  "action",
  { mentionedUserIds: string[]; channelId: Id<"channels">; plainText: string; mentionedBy: { name: string; id: Id<"users"> } },
  null
>("chatNotifications:notifyMessageMentions");
import { getAll } from "convex-helpers/server/relationships";
import { extractMentionedUserIds, extractPlainTextFromBody, extractProjectIds, extractResourceReferenceIds, extractTaskMentionIds } from "./utils/blocknote";
import { getUserDisplayName } from "@shared/displayName";
import { DatabaseReader } from "./_generated/server";

/**
 * Enrich messages with mentionedUsers record, batch-resolving all @mentions
 * found in message bodies so the client can render them instantly.
 */
async function enrichWithMentionedUsers<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  userMap: Map<string, Doc<"users"> | null>,
): Promise<(T & { mentionedUsers: Record<string, { name: string | null; email?: string | null; image?: string }> })[]> {
  // Collect all mentioned user IDs across all message bodies
  const allMentionedIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractMentionedUserIds(msg.body)) {
      allMentionedIds.add(id);
    }
  }

  // Batch-fetch any not already in userMap
  const missingIds = [...allMentionedIds].filter(id => !userMap.has(id));
  if (missingIds.length > 0) {
    const fetched = await getAll(ctx.db, missingIds as Id<"users">[]);
    fetched.forEach((u, i) => {
      userMap.set(missingIds[i], u);
    });
  }

  // Build per-message mentionedUsers record
  return messages.map(msg => {
    const mentionedIds = extractMentionedUserIds(msg.body);
    const mentionedUsers: Record<string, { name: string | null; email?: string | null; image?: string }> = {};
    for (const id of mentionedIds) {
      const u = userMap.get(id);
      if (u) {
        mentionedUsers[id] = { name: u.name ?? null, email: u.email ?? null, image: u.image };
      }
    }
    return { ...msg, mentionedUsers };
  });
}

/**
 * Enrich messages with mentionedTasks record, batch-resolving all #task mentions.
 */
async function enrichWithMentionedTasks<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
): Promise<(T & { mentionedTasks: Record<string, { title: string; projectId: string; statusColor?: string }> })[]> {
  const allTaskIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractTaskMentionIds(msg.body)) {
      allTaskIds.add(id);
    }
  }

  const taskIds = [...allTaskIds];
  const taskMap = new Map<string, { title: string; projectId: string; statusId: string } | null>();
  if (taskIds.length > 0) {
    const tasks = await getAll(ctx.db, taskIds as Id<"tasks">[]);
    tasks.forEach((t, i) => {
      taskMap.set(taskIds[i], t ? { title: t.title, projectId: t.projectId as string, statusId: t.statusId as string } : null);
    });
  }

  // Batch-fetch statuses for all tasks
  const statusIds = [...new Set(
    [...taskMap.values()].filter(t => t).map(t => t!.statusId)
  )];
  const statusMap = new Map<string, string>();
  if (statusIds.length > 0) {
    const statuses = await getAll(ctx.db, statusIds as Id<"taskStatuses">[]);
    statuses.forEach((s, i) => {
      if (s) statusMap.set(statusIds[i], s.color);
    });
  }

  return messages.map(msg => {
    const ids = extractTaskMentionIds(msg.body);
    const mentionedTasks: Record<string, { title: string; projectId: string; statusColor?: string }> = {};
    for (const id of ids) {
      const t = taskMap.get(id);
      if (t) {
        mentionedTasks[id] = { title: t.title, projectId: t.projectId, statusColor: statusMap.get(t.statusId) };
      }
    }
    return { ...msg, mentionedTasks };
  });
}

/**
 * Enrich messages with mentionedProjects record, batch-resolving all #project references.
 */
async function enrichWithMentionedProjects<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
): Promise<(T & { mentionedProjects: Record<string, { name: string; color: string }> })[]> {
  const allProjectIds = new Set<string>();
  for (const msg of messages) {
    for (const id of extractProjectIds(msg.body)) {
      allProjectIds.add(id);
    }
  }

  const projectIds = [...allProjectIds];
  const projectMap = new Map<string, { name: string; color: string } | null>();
  if (projectIds.length > 0) {
    const projects = await getAll(ctx.db, projectIds as Id<"projects">[]);
    projects.forEach((p, i) => {
      projectMap.set(projectIds[i], p ? { name: p.name, color: p.color } : null);
    });
  }

  return messages.map(msg => {
    const ids = extractProjectIds(msg.body);
    const mentionedProjects: Record<string, { name: string; color: string }> = {};
    for (const id of ids) {
      const p = projectMap.get(id);
      if (p) {
        mentionedProjects[id] = p;
      }
    }
    return { ...msg, mentionedProjects };
  });
}

/**
 * Enrich messages with mentionedResources record, batch-resolving
 * document, diagram, and spreadsheet references.
 */
async function enrichWithMentionedResources<T extends { body: string }>(
  ctx: { db: DatabaseReader },
  messages: T[],
): Promise<(T & { mentionedResources: Record<string, { name: string; type: "document" | "diagram" | "spreadsheet" }> })[]> {
  // Collect all resource refs across all messages
  const allRefs = new Map<string, string>(); // id → type
  for (const msg of messages) {
    for (const ref of extractResourceReferenceIds(msg.body)) {
      allRefs.set(ref.id, ref.type);
    }
  }

  // Group IDs by table for batch fetching
  const docIds: string[] = [];
  const diagramIds: string[] = [];
  const sheetIds: string[] = [];
  for (const [id, type] of allRefs) {
    if (type === "document") docIds.push(id);
    else if (type === "diagram") diagramIds.push(id);
    else if (type === "spreadsheet") sheetIds.push(id);
  }

  // Batch-fetch from each table
  const resourceMap = new Map<string, { name: string; type: "document" | "diagram" | "spreadsheet" }>();

  if (docIds.length > 0) {
    const docs = await getAll(ctx.db, docIds as Id<"documents">[]);
    docs.forEach((d, i) => {
      if (d) resourceMap.set(docIds[i], { name: d.name, type: "document" });
    });
  }
  if (diagramIds.length > 0) {
    const diagrams = await getAll(ctx.db, diagramIds as Id<"diagrams">[]);
    diagrams.forEach((d, i) => {
      if (d) resourceMap.set(diagramIds[i], { name: d.name, type: "diagram" });
    });
  }
  if (sheetIds.length > 0) {
    const sheets = await getAll(ctx.db, sheetIds as Id<"spreadsheets">[]);
    sheets.forEach((s, i) => {
      if (s) resourceMap.set(sheetIds[i], { name: s.name, type: "spreadsheet" });
    });
  }

  return messages.map(msg => {
    const refs = extractResourceReferenceIds(msg.body);
    const mentionedResources: Record<string, { name: string; type: "document" | "diagram" | "spreadsheet" }> = {};
    for (const ref of refs) {
      const r = resourceMap.get(ref.id);
      if (r) mentionedResources[ref.id] = r;
    }
    return { ...msg, mentionedResources };
  });
}

/**
 * Enrich messages with replyTo info, resolving mention text from parent bodies.
 * Shared by list, search, and getMessageContext queries.
 */
async function enrichWithReplyTo<T extends { replyToId?: Id<"messages"> }>(
  ctx: { db: DatabaseReader },
  messages: T[],
  userMap: Map<string, Doc<"users"> | null>,
): Promise<(T & { replyTo: { author: string; plainText: string; deleted: boolean } | null })[]> {
  // Batch-fetch parent messages
  const parentIds = [...new Set(
    messages.filter(m => m.replyToId).map(m => m.replyToId!)
  )];
  const parents = parentIds.length > 0 ? await getAll(ctx.db, parentIds) : [];
  const parentMap = new Map(parents.map((p, i) => [parentIds[i], p]));

  // Collect parent author user IDs not already in userMap
  const missingParentUserIds = [...new Set(
    parents.filter(p => p && !userMap.has(p.userId)).map(p => p!.userId)
  )];

  // Also collect user IDs mentioned inside parent bodies
  const mentionedUserIds = [...new Set(
    parents.filter(p => p?.body).flatMap(p => extractMentionedUserIds(p!.body))
  )].filter(id => !userMap.has(id));

  const allMissingIds = [...new Set([...missingParentUserIds, ...mentionedUserIds])];
  if (allMissingIds.length > 0) {
    const fetched = await getAll(ctx.db, allMissingIds as Id<"users">[]);
    fetched.forEach((u, i) => {
      if (u) userMap.set(allMissingIds[i], u);
    });
  }

  // Build user name map for mention text extraction
  const userNameMap = new Map<string, string>();
  for (const [id, u] of userMap) {
    if (u) userNameMap.set(id, getUserDisplayName(u));
  }

  // Batch-fetch project names for parent message mentions
  const allParentProjectIds = [...new Set(
    parents.filter(p => p?.body).flatMap(p => extractProjectIds(p!.body))
  )];
  const projectNameMap = new Map<string, string>();
  if (allParentProjectIds.length > 0) {
    const projects = await getAll(ctx.db, allParentProjectIds as any);
    projects.forEach((p, i) => {
      if (p && "name" in p) projectNameMap.set(allParentProjectIds[i], (p as any).name);
    });
  }

  // Enrich each message
  return messages.map((msg) => {
    if (!msg.replyToId) {
      return { ...msg, replyTo: null };
    }
    const parent = parentMap.get(msg.replyToId);
    if (!parent) {
      return { ...msg, replyTo: null };
    }
    const parentUser = userMap.get(parent.userId);
    const plainText = extractPlainTextFromBody(parent.body, userNameMap, projectNameMap) || parent.plainText;
    return {
      ...msg,
      replyTo: {
        author: getUserDisplayName(parentUser),
        plainText,
        deleted: parent.deleted,
      },
    };
  });
}

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
      replyToId: v.optional(v.id("messages")),
      author: v.string(),
      replyTo: v.union(v.null(), v.object({ author: v.string(), plainText: v.string(), deleted: v.boolean() })),
      mentionedUsers: v.any(),
      mentionedTasks: v.any(),
      mentionedProjects: v.any(),
      mentionedResources: v.any(),
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
      return { ...message, author: getUserDisplayName(user) };
    });

    const messagesWithReplyTo = await enrichWithReplyTo(ctx, messagesWithAuthor, userMap);
    const messagesWithMentions = await enrichWithMentionedUsers(ctx, messagesWithReplyTo, userMap);
    const messagesWithTasks = await enrichWithMentionedTasks(ctx, messagesWithMentions);
    const messagesWithProjects = await enrichWithMentionedProjects(ctx, messagesWithTasks);
    const messagesWithResources = await enrichWithMentionedResources(ctx, messagesWithProjects);

    return {
      ...messagesPage,
      page: messagesWithResources,
    };
  },
});

export const send = mutation({
  args: {
    isomorphicId: v.string(),
    body: v.string(),
    plainText: v.string(),
    channelId: v.id("channels"),
    replyToId: v.optional(v.id("messages")),
  },
  returns: v.null(),
  handler: async (ctx, { body, channelId, plainText, isomorphicId, replyToId }) => {
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
      replyToId,
    });

    // Extract @mentions and schedule chat mention notifications
    const mentionedUserIds = extractMentionedUserIds(body);
    const filteredMentions = mentionedUserIds.filter(id => id !== userId);

    if (filteredMentions.length > 0) {
      await ctx.scheduler.runAfter(0, notifyMessageMentionsRef, {
        mentionedUserIds: filteredMentions,
        channelId,
        plainText,
        mentionedBy: {
          name: getUserDisplayName(user),
          id: userId,
        },
      });
    }

    await ctx.scheduler.runAfter(0, sendPushNotificationRef, {
      channelId,
      body: plainText,
      author: {
        name: getUserDisplayName(user),
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
    replyToId: v.optional(v.id("messages")),
    author: v.string(),
    replyTo: v.union(v.null(), v.object({ author: v.string(), plainText: v.string(), deleted: v.boolean() })),
    mentionedUsers: v.any(),
    mentionedTasks: v.any(),
    mentionedProjects: v.any(),
    mentionedResources: v.any(),
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
      return { ...message, author: getUserDisplayName(user) };
    });

    const searchResultsWithReplyTo = await enrichWithReplyTo(ctx, searchResultsWithAuthor, userMap);
    const searchResultsWithMentions = await enrichWithMentionedUsers(ctx, searchResultsWithReplyTo, userMap);
    const searchResultsWithTasks = await enrichWithMentionedTasks(ctx, searchResultsWithMentions);
    const searchResultsWithProjects = await enrichWithMentionedProjects(ctx, searchResultsWithTasks);
    const searchResultsWithResources = await enrichWithMentionedResources(ctx, searchResultsWithProjects);

    return searchResultsWithResources;
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
      replyToId: v.optional(v.id("messages")),
      author: v.string(),
      replyTo: v.union(v.null(), v.object({ author: v.string(), plainText: v.string(), deleted: v.boolean() })),
      mentionedUsers: v.any(),
      mentionedTasks: v.any(),
      mentionedProjects: v.any(),
      mentionedResources: v.any(),
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
      return { ...message, author: getUserDisplayName(user) };
    });

    const messagesWithReplyTo = await enrichWithReplyTo(ctx, messagesWithAuthor, userMap);
    const messagesWithMentions = await enrichWithMentionedUsers(ctx, messagesWithReplyTo, userMap);
    const messagesWithTasks = await enrichWithMentionedTasks(ctx, messagesWithMentions);
    const messagesWithProjects = await enrichWithMentionedProjects(ctx, messagesWithTasks);
    const messagesWithResources = await enrichWithMentionedResources(ctx, messagesWithProjects);

    return {
      messages: messagesWithResources,
      targetMessageId: messageId,
      targetIndex: messagesBefore.length // Index of the target message in the results
    };
  },
});
