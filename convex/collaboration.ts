import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// HMAC token signing helpers
// ---------------------------------------------------------------------------

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(payload: object, secret: string): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );

  return `${payloadB64}.${base64urlEncode(signatureBytes)}`;
}

// ---------------------------------------------------------------------------
// Public action: Generate HMAC-signed collaboration token
// ---------------------------------------------------------------------------

/**
 * Generate an HMAC-signed collaboration token for PartyKit room access.
 *
 * Flow:
 * 1. Verify user is authenticated via Convex auth
 * 2. Check user has access to the resource
 * 3. Fetch user info (name/image) to embed in the token
 * 4. Sign payload with HMAC-SHA256 using PARTYKIT_SECRET
 * 5. Return signed token and roomId (no DB write — stateless)
 *
 * PartyKit verifies the token locally using the same shared secret,
 * eliminating the need for a callback to Convex on every connection.
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
    } else if (resourceType === "diagram") {
      const hasAccess = await ctx.runQuery(internal.collaboration.checkDiagramAccess, {
        userId,
        diagramId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this diagram");
      }
    } else if (resourceType === "spreadsheet") {
      const hasAccess = await ctx.runQuery(internal.collaboration.checkSpreadsheetAccess, {
        userId,
        spreadsheetId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this spreadsheet");
      }
    } else {
      // presence: check workspace membership
      const hasAccess = await ctx.runQuery(internal.collaboration.checkWorkspaceAccess, {
        userId,
        workspaceId: resourceId,
      });
      if (!hasAccess) {
        throw new ConvexError("You do not have access to this workspace");
      }
    }

    // Fetch user info to embed in the signed token
    const userInfo = await ctx.runQuery(internal.collaboration.getUserInfo, { userId });

    const roomId = `${resourceType}-${resourceId}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Sign token with HMAC-SHA256 — no DB storage needed
    const secret = process.env.PARTYKIT_SECRET;
    if (!secret) {
      throw new ConvexError("Server configuration error: PARTYKIT_SECRET not set");
    }

    const token = await signToken(
      {
        sub: userId,
        name: userInfo.userName ?? "",
        img: userInfo.userImage ?? null,
        room: roomId,
        exp: expiresAt,
      },
      secret,
    );

    return { token, roomId };
  },
});

// ---------------------------------------------------------------------------
// Internal access-check queries (used by the action above and check-access endpoint)
// ---------------------------------------------------------------------------

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
 * Consolidates the resource-specific checks into one function.
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
