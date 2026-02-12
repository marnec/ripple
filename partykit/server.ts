import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import type { ErrorCode, ServerMessage } from "@shared/protocol";

export default class CollaborationServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  /**
   * Auth gate: Verify token before allowing Yjs connection.
   *
   * Flow:
   * 1. Extract token from connection URL query params
   * 2. Call Convex HTTP endpoint to verify token and room access
   * 3. If valid, allow connection and delegate to y-partykit
   * 4. If invalid, close connection
   */
  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Extract token from query params
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      console.error("Missing auth token for room", this.room.id);
      const errorCode: ErrorCode = "AUTH_MISSING";
      const errorMessage: ServerMessage = { type: "auth_error", code: errorCode };
      conn.send(JSON.stringify(errorMessage));
      conn.close(1008, errorCode);
      return;
    }

    // Verify token with Convex
    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    if (!convexSiteUrl) {
      console.error("CONVEX_SITE_URL not configured");
      const errorCode: ErrorCode = "SERVER_CONFIG_ERROR";
      const errorMessage: ServerMessage = { type: "error", code: errorCode };
      conn.send(JSON.stringify(errorMessage));
      conn.close(1011, errorCode);
      return;
    }

    try {
      const response = await fetch(`${convexSiteUrl}/collaboration/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId: this.room.id }),
      });

      if (!response.ok) {
        console.error(
          `Auth failed for room ${this.room.id}: ${response.status} ${response.statusText}`
        );
        const errorCode: ErrorCode = "AUTH_INVALID";
        const errorMessage: ServerMessage = { type: "auth_error", code: errorCode };
        conn.send(JSON.stringify(errorMessage));
        conn.close(1008, errorCode);
        return;
      }

      const userData = (await response.json()) as {
        userId: string;
        userName: string;
      };
      console.log(`User ${userData.userName} (${userData.userId}) connected to room ${this.room.id}`);

      // Auth successful - delegate to y-partykit
      return onConnect(conn, this.room, {
        persist: { mode: "snapshot" },
      });
    } catch (error) {
      console.error("Auth verification error:", error);
      const errorCode: ErrorCode = "SERVER_INTERNAL_ERROR";
      const errorMessage: ServerMessage = { type: "error", code: errorCode };
      conn.send(JSON.stringify(errorMessage));
      conn.close(1011, errorCode);
    }
  }
}
