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

export default http;
