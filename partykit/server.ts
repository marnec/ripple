import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import type { YPartyKitOptions } from "y-partykit";
import * as Y from "yjs";
import type { ErrorCode, ServerMessage } from "@shared/protocol";
import { parseCellName, parseRange } from "@shared/cellRef";

// Constants
const PERIODIC_SAVE_INTERVAL = 120_000; // 2 minutes
const DISCONNECT_DEBOUNCE = 7_000; // 7 seconds
const CELL_REF_DEBOUNCE = 2_000; // 2 seconds
const CELL_REF_CACHE_TTL = 60_000; // 1 minute
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
  private dirty = false; // Tracks whether the doc has changed since last save
  private cachedRoomId: string | null = null; // Avoids this.room.id in alarm context

  // Cell reference observer state (spreadsheet rooms only)
  private cellRefObserver: ((events: Y.YEvent<any>[], tx: Y.Transaction) => void) | null = null;
  private cellRefPushTimeout: ReturnType<typeof setTimeout> | null = null;
  private trackedCellRefs: Array<{ cellRef: string }> | null = null;
  private trackedCellRefsLastFetch = 0;

  constructor(readonly room: Party.Room) {}

  /**
   * Pre-load the Y.Doc before any connections arrive.
   * PartyKit guarantees onStart completes before onConnect is called,
   * so the doc is cached in y-partykit's internal Map by the time the
   * first WebSocket connects — eliminating the async window that causes
   * "Connection dropped during Yjs setup" failures.
   *
   * IMPORTANT: We do NOT use y-partykit's `load` callback because it
   * internally V1-encodes the returned Y.Doc (encodeStateAsUpdate + applyUpdate),
   * which triggers a TCMalloc memory corruption bug in workerd. Instead we
   * create the doc empty via unstable_getYDoc, then apply V2 bytes directly.
   */
  async onStart() {
    const roomId = this.room.id;
    this.cachedRoomId = roomId;
    await this.room.storage.put("roomId", roomId);

    try {
      // Create empty Y.Doc in y-partykit's cache (no load callback = no V1 encoding)
      this.yDocRef = await unstable_getYDoc(this.room, this.getYjsOptions());

      // Load V2 snapshot from Convex and apply directly — bypasses y-partykit's
      // internal V1 encodeStateAsUpdate/applyUpdate that causes workerd OOM crashes
      const snapshotV2 = await this.fetchSnapshotV2FromConvex(roomId);
      if (snapshotV2) {
        Y.applyUpdateV2(this.yDocRef, snapshotV2);
        console.log(`Loaded snapshot for room ${roomId}`);
      }

      // Track document changes so we only save when dirty
      this.yDocRef.on("update", () => {
        this.dirty = true;
      });

      console.log(`Pre-loaded Y.Doc for room ${roomId}`);

      // Attach cell ref observer early for spreadsheet rooms
      if (roomId.startsWith("spreadsheet-")) {
        this.setupCellRefObserver(roomId);
      }
    } catch (e) {
      console.warn(`Failed to pre-load Y.Doc for room ${roomId}:`, e);
    }
  }

  /**
   * Get y-partykit options.
   *
   * NOTE: No `load` callback and no `persist`. We handle persistence ourselves
   * via Convex snapshot save/load. The `load` callback is intentionally omitted
   * because y-partykit internally V1-encodes the returned Y.Doc, which triggers
   * a workerd TCMalloc memory corruption bug. Without `persist`, the doc stays
   * cached in memory between connections so auto-reconnects resolve instantly.
   */
  private getYjsOptions(): YPartyKitOptions {
    return {};
  }

  /**
   * Fetch raw V2-encoded Yjs snapshot bytes from Convex.
   * Returns null if no snapshot exists (new document) or on error.
   *
   * Unlike the old loadSnapshotFromConvex which returned a Y.Doc (triggering
   * y-partykit's internal V1 re-encoding), this returns raw bytes so callers
   * can apply them directly via Y.applyUpdateV2.
   */
  private async fetchSnapshotV2FromConvex(roomId: string): Promise<Uint8Array | null> {
    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    const secret = this.room.env.PARTYKIT_SECRET as string;

    if (!convexSiteUrl || !secret) {
      console.warn("Cannot load snapshot: missing CONVEX_SITE_URL or PARTYKIT_SECRET");
      return null;
    }

    try {
      const response = await fetch(
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(roomId)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${secret}`,
          },
        }
      );

      if (response.status === 404) {
        console.log(`No snapshot found for room ${roomId} (new document)`);
        return null;
      }

      if (!response.ok) {
        console.error(`Failed to load snapshot for room ${roomId}: ${response.status}`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      console.error(`Error loading snapshot for room ${roomId}:`, error);
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
   * Save Yjs snapshot to Convex using V2 encoding.
   *
   * V2 encoding is used because Yjs V1's binary layout can trigger a memory
   * corruption bug in workerd's TCMalloc allocator when passed as a large fetch
   * body inside a Durable Object alarm handler. V2 uses delta-encoded clocks and
   * a different byte layout that avoids the problematic patterns.
   *
   * Snapshot format: 1-byte version prefix (0x02) + V2-encoded update bytes.
   * The prefix allows the loader to detect V2 vs legacy V1 snapshots.
   *
   * Logs errors but does not throw (fails gracefully).
   */
  private async saveSnapshotToConvex(roomId: string): Promise<void> {
    try {
      // Use cached yDoc reference (avoids accessing Party.id which throws in onAlarm)
      if (!this.yDocRef) {
        console.warn(`No yDoc reference for room ${roomId}, skipping save`);
        return;
      }

      // Skip save if nothing changed since last save — avoids unnecessary fetch()
      // calls that accumulate and eventually trigger a workerd TCMalloc corruption bug
      if (!this.dirty) {
        console.log(`Skipping save for room ${roomId}: no changes since last save`);
        return;
      }

      // Use V2 encoding: more compact and avoids a workerd TCMalloc corruption
      // bug triggered by certain Yjs V1 byte patterns in large fetch bodies.
      const updateV2 = Y.encodeStateAsUpdateV2(this.yDocRef);

      // Skip save if document is empty
      if (updateV2.length === 0) {
        console.log(`Skipping save for room ${roomId}: empty document`);
        return;
      }

      console.log(`Snapshot size for room ${roomId}: ${updateV2.length} bytes (V2)`);

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
          body: updateV2 as Uint8Array<ArrayBuffer>,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error(
          `Failed to save snapshot for room ${roomId}: ${response.status} ${text}`
        );
        return;
      }

      this.dirty = false;
      console.log(`Snapshot saved for room ${roomId}`);
    } catch (error) {
      console.error(`Error saving snapshot for room ${roomId}:`, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Cell reference observer (spreadsheet rooms only)
  // ---------------------------------------------------------------------------

  /**
   * Attach a Yjs deep observer on the spreadsheet data array.
   * On any cell change, debounce and push updated values to Convex.
   */
  private setupCellRefObserver(roomId: string): void {
    if (!this.yDocRef) return;
    if (this.cellRefObserver) return; // Already attached

    const yData = this.yDocRef.getArray("data");

    this.cellRefObserver = () => {
      if (this.cellRefPushTimeout) clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = setTimeout(() => {
        void this.pushCellRefUpdates(roomId);
      }, CELL_REF_DEBOUNCE);
    };

    yData.observeDeep(this.cellRefObserver);
    console.log(`Cell ref observer attached for room ${roomId}`);
  }

  /**
   * Fetch tracked cell refs from Convex (with TTL cache), read current values
   * from the Yjs document, and push updates to Convex if any are tracked.
   */
  private async pushCellRefUpdates(roomId: string): Promise<void> {
    if (!this.yDocRef) return;

    const convexSiteUrl = this.room.env.CONVEX_SITE_URL as string;
    const secret = this.room.env.PARTYKIT_SECRET as string;
    if (!convexSiteUrl || !secret) return;

    const spreadsheetId = roomId.replace("spreadsheet-", "");

    // Fetch tracked cell refs (with TTL caching)
    if (
      !this.trackedCellRefs ||
      Date.now() - this.trackedCellRefsLastFetch > CELL_REF_CACHE_TTL
    ) {
      try {
        const response = await fetch(
          `${convexSiteUrl}/collaboration/cell-refs?spreadsheetId=${encodeURIComponent(spreadsheetId)}`,
          { headers: { Authorization: `Bearer ${secret}` } },
        );
        if (response.ok) {
          this.trackedCellRefs = (await response.json()) as Array<{ cellRef: string }>;
          this.trackedCellRefsLastFetch = Date.now();
        }
      } catch (e) {
        console.error("Failed to fetch tracked cell refs:", e);
        return;
      }
    }

    if (!this.trackedCellRefs || this.trackedCellRefs.length === 0) return;

    // Extract current values from Yjs for each tracked reference
    const yData = this.yDocRef.getArray<Y.Map<string>>("data");

    const updates: Array<{ cellRef: string; values: string }> = [];

    for (const { cellRef } of this.trackedCellRefs) {
      const values = this.extractCellValues(yData, cellRef);
      if (values) {
        updates.push({ cellRef, values: JSON.stringify(values) });
      }
    }

    if (updates.length === 0) return;

    // Push to Convex
    try {
      await fetch(`${convexSiteUrl}/collaboration/cell-values`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spreadsheetId, updates }),
      });
    } catch (e) {
      console.error("Failed to push cell ref updates:", e);
    }
  }

  /**
   * Read cell values from the Yjs data array for a given cell ref.
   * Returns a 2D string array, or null if the ref is invalid.
   */
  private extractCellValues(
    yData: Y.Array<Y.Map<string>>,
    cellRef: string,
  ): string[][] | null {
    if (cellRef.includes(":")) {
      const range = parseRange(cellRef);
      if (!range) return null;
      const result: string[][] = [];
      for (let r = range.startRow; r <= range.endRow && r < yData.length; r++) {
        const row: string[] = [];
        const rowMap = yData.get(r);
        for (let c = range.startCol; c <= range.endCol; c++) {
          row.push(rowMap?.get(String(c)) ?? "");
        }
        result.push(row);
      }
      return result;
    } else {
      const cell = parseCellName(cellRef);
      if (!cell) return null;
      if (cell.row >= yData.length) return [[""]];
      const rowMap = yData.get(cell.row);
      return [[rowMap?.get(String(cell.col)) ?? ""]];
    }
  }

  /**
   * Clean up cell ref observer and pending timeout.
   */
  private cleanupCellRefObserver(): void {
    if (this.cellRefObserver && this.yDocRef) {
      this.yDocRef.getArray("data").unobserveDeep(this.cellRefObserver);
      this.cellRefObserver = null;
    }
    if (this.cellRefPushTimeout) {
      clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = null;
    }
    this.trackedCellRefs = null;
    this.trackedCellRefsLastFetch = 0;
  }

  /**
   * Safe room ID accessor. Uses the in-memory cache set during onStart.
   * Falls back to this.room.id, which throws in onAlarm context but is fine
   * everywhere else. Never accesses durable storage (async).
   */
  private getRoomId(): string {
    return this.cachedRoomId ?? this.room.id;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Use cached roomId — this.room.id can throw if an alarm handler is
    // concurrently executing in the same Durable Object isolate.
    const roomId = this.getRoomId();

    // Extract token from query params
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      console.error("Missing auth token for room", roomId);
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
        body: JSON.stringify({ roomId }),
      });

      if (!response.ok) {
        console.error(
          `Auth failed for room ${roomId}: ${response.status} ${response.statusText}`
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
      console.log(`User ${userData.userName} (${userData.userId}) connected to room ${roomId}`);

      // Store authenticated user identity on connection for downstream permission re-validation
      conn.setState({
        userId: userData.userId,
        userName: userData.userName,
      });

      // Auth successful - delegate to y-partykit (no load callback — doc already hydrated in onStart).
      // If the client disconnects mid-setup (fast navigation), y-partykit throws
      // "Network connection lost" at the workerd level. Catch it gracefully —
      // onClose will still fire and handle cleanup/save scheduling.
      try {
        await onConnect(conn, this.room, this.getYjsOptions());
      } catch {
        console.log(`Connection dropped during Yjs setup for room ${roomId}`);
        // Ensure yDocRef is set even on failure — the doc was likely loaded
        // by onStart() or a previous connection. This keeps saves working.
        if (!this.yDocRef) {
          try {
            this.yDocRef = await unstable_getYDoc(this.room, this.getYjsOptions());
          } catch { /* doc not loaded yet — will be loaded on next connection */ }
        }
        return;
      }

      // Ensure yDocRef is set (might already be set by onStart)
      if (!this.yDocRef) {
        this.yDocRef = await unstable_getYDoc(this.room, this.getYjsOptions());
        // Wire up dirty tracking if we just got the doc reference
        this.yDocRef.on("update", () => {
          this.dirty = true;
        });
      }

      // Attach cell ref observer for spreadsheet rooms (might already be attached by onStart)
      if (roomId.startsWith("spreadsheet-")) {
        this.setupCellRefObserver(roomId);
      }

      // Schedule periodic save alarm if not already scheduled
      if (!this.periodicAlarmScheduled) {
        await this.room.storage.put("alarmType", ALARM_TYPE_PERIODIC);
        await this.room.storage.setAlarm(Date.now() + PERIODIC_SAVE_INTERVAL);
        this.periodicAlarmScheduled = true;
        console.log(`Scheduled periodic save alarm for room ${roomId}`);
      }
    } catch (error) {
      // If the connection was already dropped (user navigated away fast),
      // sending to a dead socket would throw again — guard against that.
      try {
        console.error("Auth verification error:", error);
        const errorCode: ErrorCode = "SERVER_INTERNAL_ERROR";
        const errorMessage: ServerMessage = { type: "error", code: errorCode };
        conn.send(JSON.stringify(errorMessage));
        conn.close(1011, errorCode);
      } catch {
        console.log(`Connection already closed for room ${roomId}, skipping error send`);
      }
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
        // Still no connections -- save final snapshot and clean up observers.
        // Force dirty so the disconnect save always persists any pending state.
        this.dirty = true;
        console.log(`Debounce expired for room ${roomId}, saving final snapshot`);
        await this.saveSnapshotToConvex(roomId);
        this.cleanupCellRefObserver();
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
        const wasDirty = this.dirty;
        await this.saveSnapshotToConvex(roomId);
        // Only check permissions when we actually saved — avoids extra fetch()
        // calls that accumulate and trigger workerd TCMalloc corruption
        if (wasDirty) {
          await this.checkPermissions(roomId);
        }
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
