import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import type { YPartyKitOptions } from "y-partykit";
import * as Y from "yjs";
import type { ErrorCode, ServerMessage } from "@shared/protocol";

// Constants
const PERIODIC_SAVE_INTERVAL = 30_000; // 30 seconds
const DISCONNECT_DEBOUNCE = 7_000; // 7 seconds
const ALARM_TYPE_PERIODIC = "periodic";
const ALARM_TYPE_DISCONNECT = "disconnect";

// Per-connection state stored on each WebSocket connection
interface ConnectionState {
  userId: string;
  userName: string;
}

export default class CollaborationServer implements Party.Server {
  private saveAlarmScheduled = false;
  private periodicAlarmScheduled = false;
  private yDocRef: Y.Doc | null = null;

  constructor(readonly room: Party.Room) {}

  /**
   * Get y-partykit options with cold-start loading from Convex.
   */
  private getYjsOptions(): YPartyKitOptions {
    return {
      persist: { mode: "snapshot" },
      load: async () => {
        return this.loadSnapshotFromConvex();
      },
    };
  }

  /**
   * Load Yjs snapshot from Convex on cold-start.
   * Returns null if no snapshot exists (new document) or on error.
   */
  private async loadSnapshotFromConvex(): Promise<Y.Doc | null> {
    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    const secret = this.room.env.PARTYKIT_SECRET as string;

    if (!convexSiteUrl || !secret) {
      console.warn("Cannot load snapshot: missing CONVEX_SITE_URL or PARTYKIT_SECRET");
      return null;
    }

    try {
      const response = await fetch(
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(this.room.id)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${secret}`,
          },
        }
      );

      if (response.status === 404) {
        // No snapshot exists -- new document
        console.log(`No snapshot found for room ${this.room.id} (new document)`);
        return null;
      }

      if (!response.ok) {
        console.error(`Failed to load snapshot for room ${this.room.id}: ${response.status}`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const update = new Uint8Array(buffer);

      const yDoc = new Y.Doc();
      Y.applyUpdate(yDoc, update);
      console.log(`Loaded snapshot for room ${this.room.id}`);
      return yDoc;
    } catch (error) {
      console.error(`Error loading snapshot for room ${this.room.id}:`, error);
      return null;
    }
  }

  /**
   * Check permissions for all connected users.
   * Disconnects users whose access has been revoked.
   * Fails open (doesn't disconnect on check failure) to avoid disrupting legitimate users.
   */
  private async checkPermissions(roomId: string): Promise<void> {
    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    const secret = this.room.env.PARTYKIT_SECRET as string;
    if (!convexSiteUrl || !secret) return;

    for (const conn of this.room.getConnections()) {
      const state = conn.state as ConnectionState | undefined;
      if (!state?.userId) continue;

      try {
        const url = new URL(`${convexSiteUrl}/collaboration/check-access`);
        url.searchParams.set("roomId", roomId);
        url.searchParams.set("userId", state.userId);

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: { "Authorization": `Bearer ${secret}` },
        });

        if (response.ok) {
          const data = await response.json() as { hasAccess: boolean };
          if (!data.hasAccess) {
            console.log(`Permission revoked for user ${state.userId} in room ${roomId}`);
            const msg: ServerMessage = {
              type: "permission_revoked",
              reason: "Your access to this resource has been revoked",
            };
            conn.send(JSON.stringify(msg));
            conn.close(1008, "AUTH_FORBIDDEN");
          }
        }
      } catch (error) {
        // Don't disconnect on check failure — fail open to avoid disrupting legitimate users
        console.error(`Permission check failed for user ${state.userId}:`, error);
      }
    }
  }

  /**
   * Save Yjs snapshot to Convex.
   * Logs errors but does not throw (fails gracefully).
   */
  private async saveSnapshotToConvex(roomId: string): Promise<void> {
    try {
      // Use cached yDoc reference (avoids accessing Party.id which throws in onAlarm)
      if (!this.yDocRef) {
        console.warn(`No yDoc reference for room ${roomId}, skipping save`);
        return;
      }
      const update = Y.encodeStateAsUpdate(this.yDocRef);

      // Skip save if document is empty
      if (update.length === 0) {
        console.log(`Skipping save for room ${roomId}: empty document`);
        return;
      }

      // Get Convex configuration
      const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
      const secret = this.room.env.PARTYKIT_SECRET as string;

      if (!convexSiteUrl || !secret) {
        console.error("Cannot save snapshot: missing CONVEX_SITE_URL or PARTYKIT_SECRET");
        return;
      }

      // POST snapshot to Convex
      const response = await fetch(
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(roomId)}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secret}`,
            "Content-Type": "application/octet-stream",
          },
          body: update as Uint8Array<ArrayBuffer>,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `Failed to save snapshot for room ${roomId}: ${response.status} ${text}`
        );
        return;
      }

      console.log(`Snapshot saved for room ${roomId}`);
    } catch (error) {
      console.error(`Error saving snapshot for room ${roomId}:`, error);
    }
  }

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

      // Store authenticated user identity on connection for downstream permission re-validation
      conn.setState({
        userId: userData.userId,
        userName: userData.userName,
      });

      // Cache roomId in durable storage for alarm handler access
      await this.room.storage.put("roomId", this.room.id);

      // Auth successful - delegate to y-partykit with load callback
      await onConnect(conn, this.room, this.getYjsOptions());

      // Cache yDoc reference for alarm handler (avoids Party.id access limitation in onAlarm)
      this.yDocRef = await unstable_getYDoc(this.room, this.getYjsOptions());

      // Schedule periodic save alarm if not already scheduled
      if (!this.periodicAlarmScheduled) {
        await this.room.storage.put("alarmType", ALARM_TYPE_PERIODIC);
        await this.room.storage.setAlarm(Date.now() + PERIODIC_SAVE_INTERVAL);
        this.periodicAlarmScheduled = true;
        console.log(`Scheduled periodic save alarm for room ${this.room.id}`);
      }
    } catch (error) {
      console.error("Auth verification error:", error);
      const errorCode: ErrorCode = "SERVER_INTERNAL_ERROR";
      const errorMessage: ServerMessage = { type: "error", code: errorCode };
      conn.send(JSON.stringify(errorMessage));
      conn.close(1011, errorCode);
    }
  }

  /**
   * Handle connection close. If this is the last connection, schedule a debounced save.
   */
  async onClose(_conn: Party.Connection) {
    // Count remaining connections
    let connectionCount = 0;
    for (const _ of this.room.getConnections()) {
      connectionCount++;
    }

    if (connectionCount === 0) {
      // Last user disconnected -- schedule debounced save
      const roomId = await this.room.storage.get("roomId");
      if (!roomId) {
        // No roomId cached — no successful connections have been made, skip save
        return;
      }
      console.log(`Last user disconnected from room ${roomId as string}, scheduling debounced save`);
      await this.room.storage.put("alarmType", ALARM_TYPE_DISCONNECT);
      await this.room.storage.setAlarm(Date.now() + DISCONNECT_DEBOUNCE);
      this.saveAlarmScheduled = true;
      this.periodicAlarmScheduled = false; // Stop periodic saves
    }
  }

  /**
   * Handle alarms for both periodic saves and disconnect debounce.
   */
  async onAlarm() {
    const roomIdRaw = await this.room.storage.get("roomId");
    if (!roomIdRaw) {
      console.error("No cached roomId in storage — cannot process alarm");
      return;
    }
    const roomId = roomIdRaw as string;

    const alarmType = await this.room.storage.get("alarmType");

    if (alarmType === ALARM_TYPE_DISCONNECT) {
      // Check if someone reconnected during the debounce window
      let connectionCount = 0;
      for (const _ of this.room.getConnections()) {
        connectionCount++;
      }

      if (connectionCount === 0) {
        // Still no connections -- save snapshot
        console.log(`Debounce expired for room ${roomId}, saving final snapshot`);
        await this.saveSnapshotToConvex(roomId);
        this.saveAlarmScheduled = false;
      } else {
        // Someone reconnected -- cancel disconnect save
        console.log(`User reconnected to room ${roomId} during debounce, cancelling save`);
        this.saveAlarmScheduled = false;
        await this.checkPermissions(roomId);
        // Periodic alarm will be rescheduled by onConnect
      }
    } else if (alarmType === ALARM_TYPE_PERIODIC) {
      // Periodic save while users are connected
      let connectionCount = 0;
      for (const _ of this.room.getConnections()) {
        connectionCount++;
      }

      if (connectionCount > 0) {
        console.log(`Periodic save triggered for room ${roomId}`);
        await this.saveSnapshotToConvex(roomId);
        await this.checkPermissions(roomId);
        // Reschedule next periodic save
        await this.room.storage.put("alarmType", ALARM_TYPE_PERIODIC);
        await this.room.storage.setAlarm(Date.now() + PERIODIC_SAVE_INTERVAL);
      } else {
        // No connections, don't reschedule periodic. Disconnect handler will trigger save.
        this.periodicAlarmScheduled = false;
        console.log(`No connections for room ${roomId}, stopping periodic saves`);
      }
    }
  }
}
