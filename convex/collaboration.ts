import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Generate a one-time collaboration token for PartyKit room access.
 *
 * Flow:
 * 1. Verify user is authenticated via Convex auth
 * 2. Check user has access to the resource (document or diagram)
 * 3. Generate random UUID token with 5-minute expiration
 * 4. Store token in collaborationTokens table
 * 5. Return token and roomId to frontend
 */
export const getCollaborationToken = action({
  args: {
    resourceType: v.union(v.literal("doc"), v.literal("diagram"), v.literal("task")),
    resourceId: v.string(),
  },
  returns: v.object({ token: v.string(), roomId: v.string() }),
  handler: async (ctx, { resourceType, resourceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }

    // Verify user has access to the resource
    if (resourceType === "doc") {
      const hasAccess = await ctx.runQuery(internal.collaboration.checkDocumentAccess, {
        userId,
        documentId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this document");
      }
    } else if (resourceType === "task") {
      const hasAccess = await ctx.runQuery(internal.collaboration.checkTaskAccess, {
        userId,
        taskId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this task");
      }
    } else {
      const hasAccess = await ctx.runQuery(internal.collaboration.checkDiagramAccess, {
        userId,
        diagramId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this diagram");
      }
    }

    // Generate one-time token
    const token = crypto.randomUUID();
    const roomId = `${resourceType}-${resourceId}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store token
    await ctx.runMutation(internal.collaboration.storeToken, {
      token,
      userId,
      roomId,
      expiresAt,
    });

    return { token, roomId };
  },
});

/**
 * Internal query: Check if user has access to a document.
 */
export const checkDocumentAccess = internalQuery({
  args: {
    userId: v.id("users"),
    documentId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, documentId }) => {
    const member = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) =>
        q.eq("documentId", documentId as any).eq("userId", userId)
      )
      .first();
    return member !== null;
  },
});

/**
 * Internal query: Check if user has access to a diagram.
 */
export const checkDiagramAccess = internalQuery({
  args: {
    userId: v.id("users"),
    diagramId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, diagramId }) => {
    const member = await ctx.db
      .query("diagramMembers")
      .withIndex("by_diagram_user", (q) =>
        q.eq("diagramId", diagramId as any).eq("userId", userId)
      )
      .first();
    return member !== null;
  },
});

/**
 * Internal query: Check if user has access to a task.
 */
export const checkTaskAccess = internalQuery({
  args: {
    userId: v.id("users"),
    taskId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, taskId }) => {
    const task = await ctx.db.get(taskId as any) as any;
    if (!task || !task.projectId) return false;
    const member = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();
    return member !== null;
  },
});

/**
 * Internal mutation: Store a collaboration token.
 */
export const storeToken = internalMutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    roomId: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { token, userId, roomId, expiresAt }) => {
    await ctx.db.insert("collaborationTokens", {
      token,
      userId,
      roomId,
      expiresAt,
    });
    return null;
  },
});

/**
 * Internal mutation: Consume (validate and delete) a one-time token.
 * Returns user info if valid, null if invalid/expired.
 */
export const consumeToken = internalMutation({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      roomId: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, { token }) => {
    const tokenDoc = await ctx.db
      .query("collaborationTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!tokenDoc) {
      return null;
    }

    // Check expiration
    if (tokenDoc.expiresAt < Date.now()) {
      await ctx.db.delete(tokenDoc._id);
      return null;
    }

    // Valid token - delete it (one-time use) and return user info
    await ctx.db.delete(tokenDoc._id);
    return {
      userId: tokenDoc.userId,
      roomId: tokenDoc.roomId,
    };
  },
});

/**
 * Internal query: Get user info by ID.
 */
export const getUserInfo = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    userId: v.id("users"),
    userName: v.optional(v.string()),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    return {
      userId: user._id,
      userName: user.name,
    };
  },
});
