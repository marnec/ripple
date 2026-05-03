import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { hasResourceAccess } from "./authHelpers";
import { signToken } from "./tokenSigning";

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
    const hasAccess = await ctx.runQuery(internal.collaboration.checkAccess, {
      userId,
      resourceType,
      resourceId,
    });
    if (!hasAccess) {
      throw new ConvexError("You do not have access to this resource");
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
    return hasResourceAccess(ctx, userId, resourceType, resourceId);
  },
});
