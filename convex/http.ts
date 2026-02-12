import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * POST /collaboration/verify
 *
 * Validates a one-time collaboration token from PartyKit.
 * Called by PartyKit server during onConnect to verify user has access to room.
 *
 * Request:
 * - Headers: Authorization: Bearer <token>
 * - Body: { roomId: string }
 *
 * Response:
 * - 200: { userId: string, userName: string }
 * - 401: Unauthorized (missing/invalid token)
 * - 403: Forbidden (token valid but room mismatch)
 */
http.route({
  path: "/collaboration/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Extract token from Authorization header
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Missing auth token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const token = authHeader.substring(7); // Remove "Bearer "

      // Parse request body
      const body = await request.json();
      const roomId = body.roomId;

      if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate and consume token
      const tokenData = await ctx.runMutation(internal.collaboration.consumeToken, {
        token,
      });

      if (!tokenData) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Verify roomId matches the token
      if (tokenData.roomId !== roomId) {
        return new Response(JSON.stringify({ error: "Room mismatch" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Get user info
      const userInfo = await ctx.runQuery(internal.collaboration.getUserInfo, {
        userId: tokenData.userId,
      });

      return new Response(JSON.stringify(userInfo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Collaboration verify error:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

/**
 * POST /collaboration/snapshot
 *
 * Save a Yjs snapshot from PartyKit to Convex file storage.
 * Called by PartyKit server when persisting document state.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params: roomId (format: "{resourceType}-{resourceId}")
 * Body: Binary Yjs snapshot data
 *
 * Response:
 * - 200: { success: true }
 * - 400: Missing roomId
 * - 401: Unauthorized (missing/invalid secret)
 * - 500: Internal server error
 *
 * Note: Requires PARTYKIT_SECRET environment variable to be set.
 * Set via: npx convex env set PARTYKIT_SECRET <value>
 */
http.route({
  path: "/collaboration/snapshot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract roomId from query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");

      if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse roomId to extract resourceType and resourceId
      // Format: "{resourceType}-{resourceId}"
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Read binary snapshot data
      const blob = await request.blob();

      // Store in Convex file storage
      const storageId = await ctx.storage.store(blob);

      // Save snapshot reference to resource
      await ctx.runMutation(internal.snapshots.saveSnapshot, {
        resourceType,
        resourceId,
        storageId,
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Snapshot save error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

/**
 * GET /collaboration/snapshot
 *
 * Load a Yjs snapshot from Convex file storage for PartyKit cold-start hydration.
 * Called by PartyKit server when initializing a room with no in-memory state.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params: roomId (format: "{resourceType}-{resourceId}")
 *
 * Response:
 * - 200: Binary Yjs snapshot data (application/octet-stream)
 * - 400: Missing roomId
 * - 401: Unauthorized (missing/invalid secret)
 * - 404: No snapshot found
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/snapshot",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract roomId from query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");

      if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse roomId to extract resourceType and resourceId
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Get snapshot storage ID
      const storageId = await ctx.runQuery(internal.snapshots.getSnapshot, {
        resourceType,
        resourceId,
      });

      if (!storageId) {
        return new Response(JSON.stringify({ error: "No snapshot found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Retrieve blob from storage
      const blob = await ctx.storage.get(storageId);

      if (!blob) {
        return new Response(
          JSON.stringify({ error: "Snapshot file not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Return binary snapshot data
      return new Response(blob, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch (error) {
      console.error("Snapshot load error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

/**
 * GET /collaboration/check-access
 *
 * Verify if a user still has access to a collaboration room.
 * Called by PartyKit server for periodic permission re-validation.
 *
 * Authentication: Shared secret via Authorization: Bearer <PARTYKIT_SECRET>
 * Query params:
 *   - roomId (format: "{resourceType}-{resourceId}")
 *   - userId (Convex user document ID)
 *
 * Response:
 * - 200: { hasAccess: true } or { hasAccess: false }
 * - 400: Missing parameters
 * - 401: Unauthorized (missing/invalid secret)
 * - 500: Internal server error
 */
http.route({
  path: "/collaboration/check-access",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      // Validate shared secret
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.PARTYKIT_SECRET;

      if (!expectedSecret) {
        console.error(
          "PARTYKIT_SECRET environment variable not configured"
        );
        return new Response(
          JSON.stringify({ error: "Server configuration error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const providedSecret = authHeader.substring(7); // Remove "Bearer "
      if (providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract query params
      const url = new URL(request.url);
      const roomId = url.searchParams.get("roomId");
      const userId = url.searchParams.get("userId");

      if (!roomId || !userId) {
        return new Response(
          JSON.stringify({ error: "Missing roomId or userId" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Parse roomId to extract resourceType and resourceId
      const dashIndex = roomId.indexOf("-");
      if (dashIndex === -1) {
        return new Response(
          JSON.stringify({ error: "Invalid roomId format" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const resourceType = roomId.substring(0, dashIndex);
      const resourceId = roomId.substring(dashIndex + 1);

      // Validate resource type
      if (
        resourceType !== "doc" &&
        resourceType !== "diagram" &&
        resourceType !== "task"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid resource type" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      // Check if user has access
      const hasAccess = await ctx.runQuery(internal.collaboration.checkAccess, {
        userId: userId as any,
        resourceType: resourceType as any,
        resourceId,
      });

      return new Response(JSON.stringify({ hasAccess }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Permission check error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

export default http;
