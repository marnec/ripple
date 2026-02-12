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

export default class CollaborationServer implements Party.Server {
  private saveAlarmScheduled = false;
  private periodicAlarmScheduled = false;

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
   * Save Yjs snapshot to Convex.
   * Logs errors but does not throw (fails gracefully).
   */
  private async saveSnapshotToConvex(): Promise<void> {
    try {
      // Get the current Yjs document state
      const yDoc = await unstable_getYDoc(this.room, this.getYjsOptions());
      const update = Y.encodeStateAsUpdate(yDoc);

      // Skip save if document is empty
      if (update.length === 0) {
        console.log(`Skipping save for room ${this.room.id}: empty document`);
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
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(this.room.id)}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secret}`,
            "Content-Type": "application/octet-stream",
          },
          body: update.buffer,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `Failed to save snapshot for room ${this.room.id}: ${response.status} ${text}`
        );
        return;
      }

      console.log(`Snapshot saved for room ${this.room.id}`);
    } catch (error) {
      console.error(`Error saving snapshot for room ${this.room.id}:`, error);
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

      // Auth successful - delegate to y-partykit with load callback
      await onConnect(conn, this.room, this.getYjsOptions());

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
      console.log(`Last user disconnected from room ${this.room.id}, scheduling debounced save`);
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
    const alarmType = await this.room.storage.get("alarmType");

    if (alarmType === ALARM_TYPE_DISCONNECT) {
      // Check if someone reconnected during the debounce window
      let connectionCount = 0;
      for (const _ of this.room.getConnections()) {
        connectionCount++;
      }

      if (connectionCount === 0) {
        // Still no connections -- save snapshot
        console.log(`Debounce expired for room ${this.room.id}, saving final snapshot`);
        await this.saveSnapshotToConvex();
        this.saveAlarmScheduled = false;
      } else {
        // Someone reconnected -- cancel disconnect save
        console.log(`User reconnected to room ${this.room.id} during debounce, cancelling save`);
        this.saveAlarmScheduled = false;
        // Periodic alarm will be rescheduled by onConnect
      }
    } else if (alarmType === ALARM_TYPE_PERIODIC) {
      // Periodic save while users are connected
      let connectionCount = 0;
      for (const _ of this.room.getConnections()) {
        connectionCount++;
      }

      if (connectionCount > 0) {
        console.log(`Periodic save triggered for room ${this.room.id}`);
        await this.saveSnapshotToConvex();
        // Reschedule next periodic save
        await this.room.storage.put("alarmType", ALARM_TYPE_PERIODIC);
        await this.room.storage.setAlarm(Date.now() + PERIODIC_SAVE_INTERVAL);
      } else {
        // No connections, don't reschedule periodic. Disconnect handler will trigger save.
        this.periodicAlarmScheduled = false;
        console.log(`No connections for room ${this.room.id}, stopping periodic saves`);
      }
    }
  }
}
