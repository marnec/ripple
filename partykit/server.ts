import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

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
      conn.close(1008, "Missing auth token");
      return;
    }

    // Verify token with Convex
    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    if (!convexSiteUrl) {
      console.error("CONVEX_SITE_URL not configured");
      conn.close(1011, "Server configuration error");
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
        conn.close(1008, "Unauthorized");
        return;
      }

      const userData = await response.json();
      console.log(`User ${userData.userName} (${userData.userId}) connected to room ${this.room.id}`);

      // Auth successful - delegate to y-partykit
      return onConnect(conn, this.room, {
        persist: { mode: "snapshot" },
      });
    } catch (error) {
      console.error("Auth verification error:", error);
      conn.close(1011, "Auth verification failed");
    }
  }
}
