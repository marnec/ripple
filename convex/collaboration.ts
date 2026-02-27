import { getAuthUserId } from "@convex-dev/auth/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const checkDocumentAccessRef = makeFunctionReference<
  "query",
  { userId: Id<"users">; documentId: string },
  boolean
>("collaboration:checkDocumentAccess");

const checkTaskAccessRef = makeFunctionReference<
  "query",
  { userId: Id<"users">; taskId: string },
  boolean
>("collaboration:checkTaskAccess");

const checkDiagramAccessRef = makeFunctionReference<
  "query",
  { userId: Id<"users">; diagramId: string },
  boolean
>("collaboration:checkDiagramAccess");

const checkSpreadsheetAccessRef = makeFunctionReference<
  "query",
  { userId: Id<"users">; spreadsheetId: string },
  boolean
>("collaboration:checkSpreadsheetAccess");

const checkWorkspaceAccessRef = makeFunctionReference<
  "query",
  { userId: Id<"users">; workspaceId: string },
  boolean
>("collaboration:checkWorkspaceAccess");

const storeTokenRef = makeFunctionReference<
  "mutation",
  { token: string; userId: Id<"users">; roomId: string; expiresAt: number },
  null
>("collaboration:storeToken");

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
    resourceType: v.union(v.literal("doc"), v.literal("diagram"), v.literal("task"), v.literal("presence"), v.literal("spreadsheet")),
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
      const hasAccess = await ctx.runQuery(checkDocumentAccessRef, {
        userId,
        documentId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this document");
      }
    } else if (resourceType === "task") {
      const hasAccess = await ctx.runQuery(checkTaskAccessRef, {
        userId,
        taskId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this task");
      }
    } else if (resourceType === "diagram") {
      const hasAccess = await ctx.runQuery(checkDiagramAccessRef, {
        userId,
        diagramId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this diagram");
      }
    } else if (resourceType === "spreadsheet") {
      const hasAccess = await ctx.runQuery(checkSpreadsheetAccessRef, {
        userId,
        spreadsheetId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this spreadsheet");
      }
    } else {
      // presence: check workspace membership
      const hasAccess = await ctx.runQuery(checkWorkspaceAccessRef, {
        userId,
        workspaceId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this workspace");
      }
    }

    // Generate one-time token
    const token = crypto.randomUUID();
    const roomId = `${resourceType}-${resourceId}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store token
    await ctx.runMutation(storeTokenRef, {
      token,
      userId,
      roomId,
      expiresAt,
    });

    return { token, roomId };
  },
});

/**
 * Internal query: Check if user has access to a workspace.
 */
export const checkWorkspaceAccess = internalQuery({
  args: {
    userId: v.id("users"),
    workspaceId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, workspaceId }) => {
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId as any).eq("userId", userId)
      )
      .first();
    return member !== null;
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
    const document = await ctx.db.get(documentId as any);
    if (!document) return false;
    const workspaceMember = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", (document as any).workspaceId).eq("userId", userId)
      )
      .first();
    return workspaceMember !== null;
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
    // Check workspace membership (diagrams are accessible to all workspace members)
    const diagram = await ctx.db.get(diagramId as any) as { workspaceId: any } | null;
    if (!diagram) return false;
    const workspaceMember = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", diagram.workspaceId).eq("userId", userId)
      )
      .first();
    return workspaceMember !== null;
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
    if (!task || !task.workspaceId) return false;
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    return member !== null;
  },
});

/**
 * Internal query: Check if user has access to a spreadsheet.
 */
export const checkSpreadsheetAccess = internalQuery({
  args: {
    userId: v.id("users"),
    spreadsheetId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, spreadsheetId }) => {
    const spreadsheet = await ctx.db.get(spreadsheetId as any);
    if (!spreadsheet) return false;
    const member = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", (spreadsheet as any).workspaceId).eq("userId", userId)
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
 * Internal mutation: Verify a collaboration token.
 * Tokens are reusable within their 5-minute validity window to support
 * y-partykit's built-in auto-reconnect (which reuses the same URL/token).
 * Expired tokens are cleaned up on access.
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

    // Check expiration - clean up expired tokens
    if (tokenDoc.expiresAt < Date.now()) {
      await ctx.db.delete(tokenDoc._id);
      return null;
    }

    // Valid token - allow reuse within validity window
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
    userImage: v.optional(v.string()),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    return {
      userId: user._id,
      userName: user.name,
      userImage: user.image,
    };
  },
});

/**
 * Internal query: Check if user still has access to a resource.
 *
 * Used by PartyKit server for periodic permission re-validation.
 * Consolidates the three resource-specific checks into one function.
 */
export const checkAccess = internalQuery({
  args: {
    userId: v.id("users"),
    resourceType: v.union(v.literal("doc"), v.literal("diagram"), v.literal("task"), v.literal("presence"), v.literal("spreadsheet")),
    resourceId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, resourceType, resourceId }) => {
    if (resourceType === "doc") {
      // Check workspace membership (documents are accessible to all workspace members)
      const document = await ctx.db.get(resourceId as any);
      if (!document) return false;
      const workspaceMember = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", (document as any).workspaceId).eq("userId", userId)
        )
        .first();
      return workspaceMember !== null;
    } else if (resourceType === "diagram") {
      // Check workspace membership (diagrams are accessible to all workspace members)
      const diagram = await ctx.db.get(resourceId as any);
      if (!diagram) return false;
      const workspaceMember = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", (diagram as any).workspaceId).eq("userId", userId)
        )
        .first();
      return workspaceMember !== null;
    } else if (resourceType === "task") {
      const task = await ctx.db.get(resourceId as any);
      if (!task) return false;
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", (task as any).workspaceId).eq("userId", userId)
        )
        .first();
      return member !== null;
    } else if (resourceType === "spreadsheet") {
      const spreadsheet = await ctx.db.get(resourceId as any);
      if (!spreadsheet) return false;
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", (spreadsheet as any).workspaceId).eq("userId", userId)
        )
        .first();
      return member !== null;
    } else {
      // presence: check workspace membership
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", resourceId as any).eq("userId", userId)
        )
        .first();
      return member !== null;
    }
  },
});
