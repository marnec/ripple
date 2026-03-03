import { YServer } from "y-partyserver";
import type { Connection, ConnectionContext } from "partyserver";
import * as Y from "yjs";
import type { ServerMessage } from "@shared/protocol";
import { parseCellName, parseRange } from "@shared/cellRef";
import { extractBlocksFromFragment } from "@shared/blockRef";

/**
 * If the raw cell value is a formula (starts with "="), return the computed
 * display value from formulaValues. Falls back to raw value if not available.
 */
function resolveDisplayValue(
  rawValue: string,
  row: number,
  col: number,
  yFormulaValues?: Y.Map<string>,
): string {
  if (rawValue.startsWith("=") && yFormulaValues) {
    const computed = yFormulaValues.get(`${row},${col}`);
    if (computed !== undefined) return computed;
  }
  return rawValue;
}

// Constants
const DISCONNECT_DEBOUNCE = 7_000; // 7 seconds
const PERMISSION_CHECK_INTERVAL = 120_000; // 2 minutes
const CELL_REF_DEBOUNCE = 2_000; // 2 seconds
const CELL_REF_CACHE_TTL = 60_000; // 1 minute
const BLOCK_REF_DEBOUNCE = 2_000; // 2 seconds
const BLOCK_REF_CACHE_TTL = 60_000; // 1 minute
const ALARM_TYPE_DISCONNECT = "disconnect";
const ALARM_TYPE_PERMISSION_CHECK = "permission_check";

// Per-connection state stored on each WebSocket connection
interface ConnectionState {
  userId: string;
  userName: string;
}

interface Env {
  CONVEX_SITE_URL: string;
  PARTYKIT_SECRET: string;
}

export default class CollaborationServer extends YServer {
  // Tell y-partyserver to debounce saves
  static callbackOptions = {
    debounceWait: 2_000,
    debounceMaxWait: 10_000,
  };

  private permissionCheckScheduled = false;

  // Cell reference observer state (spreadsheet rooms only)
  private cellRefObserver: ((events: Y.YEvent<any>[], tx: Y.Transaction) => void) | null = null;
  private formulaValuesObserver: ((event: Y.YMapEvent<string>) => void) | null = null;
  private cellRefPushTimeout: ReturnType<typeof setTimeout> | null = null;
  private trackedCellRefs: Array<{ cellRef: string }> | null = null;
  private trackedCellRefsLastFetch = 0;

  // Document block reference observer state (doc rooms only)
  private blockRefObserver: ((events: Y.YEvent<any>[], tx: Y.Transaction) => void) | null = null;
  private blockRefPushTimeout: ReturnType<typeof setTimeout> | null = null;
  private trackedBlockRefs: Array<{ blockId: string }> | null = null;
  private trackedBlockRefsLastFetch = 0;

  // ---------------------------------------------------------------------------
  // YServer lifecycle hooks
  // ---------------------------------------------------------------------------

  /**
   * Called by YServer before the first connection. Load snapshot from Convex.
   * YServer calls super.onStart() which calls onLoad() — so this is the right
   * place to hydrate the document.
   */
  async onStart() {
    // MUST call super.onStart() — it calls onLoad(), sets up Yjs listeners,
    // and wires up the debounced onSave() callback.
    await super.onStart();

    // Attach observers for specific room types
    const roomId = this.name;
    if (roomId.startsWith("spreadsheet-")) {
      this.setupCellRefObserver(roomId);
    } else if (roomId.startsWith("doc-")) {
      this.setupBlockRefObserver(roomId);
    }
  }

  /**
   * Load Yjs state from Convex snapshot storage.
   * Called by YServer's onStart() before listeners are attached.
   * Apply V1 bytes directly to this.document.
   */
  async onLoad(): Promise<void> {
    const roomId = this.name;
    const env = this.env as Env;
    const convexSiteUrl = env.CONVEX_SITE_URL;
    const secret = env.PARTYKIT_SECRET;

    if (!convexSiteUrl || !secret) {
      console.warn("Cannot load snapshot: missing CONVEX_SITE_URL or PARTYKIT_SECRET");
      return;
    }

    try {
      const response = await fetch(
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(roomId)}`,
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${secret}` },
        }
      );

      if (response.status === 404) {
        console.log(`No snapshot found for room ${roomId} (new document)`);
        return;
      }

      if (!response.ok) {
        console.error(`Failed to load snapshot for room ${roomId}: ${response.status}`);
        return;
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      Y.applyUpdate(this.document, bytes);
      console.log(`Loaded snapshot for room ${roomId}`);
    } catch (error) {
      console.error(`Error loading snapshot for room ${roomId}:`, error);
    }
  }

  /**
   * Save Yjs state to Convex. Called by YServer's debounced callback after
   * document updates, and when the room empties.
   * Uses V1 encoding (matches y-partyserver's internal encoding).
   */
  async onSave(): Promise<void> {
    const roomId = this.name;

    try {
      const update = Y.encodeStateAsUpdate(this.document);

      if (update.length === 0) {
        console.log(`Skipping save for room ${roomId}: empty document`);
        return;
      }

      console.log(`Snapshot size for room ${roomId}: ${update.length} bytes`);

      const env = this.env as Env;
      const convexSiteUrl = env.CONVEX_SITE_URL;
      const secret = env.PARTYKIT_SECRET;

      if (!convexSiteUrl || !secret) {
        console.error("Cannot save snapshot: missing CONVEX_SITE_URL or PARTYKIT_SECRET");
        return;
      }

      const response = await fetch(
        `${convexSiteUrl}/collaboration/snapshot?roomId=${encodeURIComponent(roomId)}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secret}`,
            "Content-Type": "application/octet-stream",
          },
          body: update,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error(`Failed to save snapshot for room ${roomId}: ${response.status} ${text}`);
        return;
      }

      console.log(`Snapshot saved for room ${roomId}`);
    } catch (error) {
      console.error(`Error saving snapshot for room ${roomId}:`, error);
    }
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Accept pre-authenticated connection and delegate to YServer for Yjs sync.
   * Auth is verified in onBeforeConnect (worker.ts) BEFORE the WebSocket
   * upgrade, so by the time we get here the user is already authenticated.
   */
  async onConnect(conn: Connection, ctx: ConnectionContext) {
    const roomId = this.name;

    // Read user identity from headers set by onBeforeConnect in worker.ts
    const userId = ctx.request.headers.get("X-Verified-User-Id");
    const userName = ctx.request.headers.get("X-Verified-User-Name");

    if (!userId) {
      // Should never happen — onBeforeConnect rejects unauthenticated requests
      // before the WebSocket upgrade. If we get here, something is misconfigured.
      console.error("Missing pre-verified user for room", roomId);
      conn.close(1008, "AUTH_MISSING");
      return;
    }

    console.log(`User ${userName} (${userId}) connected to room ${roomId}`);

    conn.setState({ userId, userName });

    // Delegate to YServer for Yjs sync setup
    try {
      await super.onConnect(conn, ctx);
    } catch {
      console.log(`Connection dropped during Yjs setup for room ${roomId}`);
      return;
    }

    // Attach observers for specific room types
    if (roomId.startsWith("spreadsheet-")) {
      this.setupCellRefObserver(roomId);
    } else if (roomId.startsWith("doc-")) {
      this.setupBlockRefObserver(roomId);
    }

    // Schedule periodic permission check alarm
    if (!this.permissionCheckScheduled) {
      await this.ctx.storage.put("alarmType", ALARM_TYPE_PERMISSION_CHECK);
      await this.ctx.storage.setAlarm(Date.now() + PERMISSION_CHECK_INTERVAL);
      this.permissionCheckScheduled = true;
    }
  }

  /**
   * Handle connection close. Delegate to YServer for awareness cleanup,
   * then schedule disconnect save if this was the last connection.
   */
  async onClose(conn: Connection, code: number, reason: string, wasClean: boolean) {
    // YServer handles awareness cleanup
    void super.onClose(conn, code, reason, wasClean);

    // Count remaining connections
    let connectionCount = 0;
    for (const _ of this.getConnections()) {
      connectionCount++;
    }

    if (connectionCount === 0) {
      const roomId = this.name;
      console.log(`Last user disconnected from room ${roomId}, scheduling debounced save`);
      await this.ctx.storage.put("alarmType", ALARM_TYPE_DISCONNECT);
      await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_DEBOUNCE);
      this.permissionCheckScheduled = false;
    }
  }

  /**
   * Handle alarms for disconnect save and permission checks.
   * YServer handles periodic saves via its debounced callback — we only use
   * alarms for disconnect debounce and permission re-validation.
   */
  async onAlarm() {
    const roomId = this.name;
    const alarmType = await this.ctx.storage.get("alarmType");

    if (alarmType === ALARM_TYPE_DISCONNECT) {
      let connectionCount = 0;
      for (const _ of this.getConnections()) {
        connectionCount++;
      }

      if (connectionCount === 0) {
        // Still no connections — flush pending ref updates, save final snapshot, clean up
        console.log(`Debounce expired for room ${roomId}, saving final snapshot`);
        await this.flushPendingRefUpdates(roomId);
        await this.onSave();
        this.cleanupCellRefObserver();
        this.cleanupBlockRefObserver();
      } else {
        console.log(`User reconnected to room ${roomId} during debounce, cancelling save`);
        await this.checkPermissions(roomId);
      }
    } else if (alarmType === ALARM_TYPE_PERMISSION_CHECK) {
      let connectionCount = 0;
      for (const _ of this.getConnections()) {
        connectionCount++;
      }

      if (connectionCount > 0) {
        await this.checkPermissions(roomId);
        // Reschedule
        await this.ctx.storage.put("alarmType", ALARM_TYPE_PERMISSION_CHECK);
        await this.ctx.storage.setAlarm(Date.now() + PERMISSION_CHECK_INTERVAL);
      } else {
        this.permissionCheckScheduled = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Permission checking
  // ---------------------------------------------------------------------------

  private async checkPermissions(roomId: string): Promise<void> {
    const env = this.env as Env;
    const convexSiteUrl = env.CONVEX_SITE_URL;
    const secret = env.PARTYKIT_SECRET;
    if (!convexSiteUrl || !secret) return;

    for (const conn of this.getConnections()) {
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
          const data: { hasAccess: boolean } = await response.json();
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
        console.error(`Permission check failed for user ${state.userId}:`, error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cell reference observer (spreadsheet rooms only)
  // ---------------------------------------------------------------------------

  private setupCellRefObserver(roomId: string): void {
    if (this.cellRefObserver) return; // Already attached

    const yData = this.document.getArray("data");

    this.cellRefObserver = () => {
      if (this.cellRefPushTimeout) clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = setTimeout(() => {
        void this.pushCellRefUpdates(roomId);
      }, CELL_REF_DEBOUNCE);
    };

    yData.observeDeep(this.cellRefObserver);

    // Also observe formulaValues changes
    const yFormulaValues = this.document.getMap<string>("formulaValues");
    this.formulaValuesObserver = () => {
      if (this.cellRefPushTimeout) clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = setTimeout(() => {
        void this.pushCellRefUpdates(roomId);
      }, CELL_REF_DEBOUNCE);
    };
    yFormulaValues.observe(this.formulaValuesObserver);

    console.log(`Cell ref observer attached for room ${roomId}`);
  }

  private async pushCellRefUpdates(roomId: string): Promise<void> {
    const env = this.env as Env;
    const convexSiteUrl = env.CONVEX_SITE_URL;
    const secret = env.PARTYKIT_SECRET;
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
          const refs: Array<{ cellRef: string }> = await response.json();
          this.trackedCellRefs = refs;
          this.trackedCellRefsLastFetch = Date.now();
        }
      } catch (e) {
        console.error("Failed to fetch tracked cell refs:", e);
        return;
      }
    }

    if (!this.trackedCellRefs || this.trackedCellRefs.length === 0) return;

    // Extract current values from Yjs
    const yData = this.document.getArray<Y.Map<string>>("data");
    const yFormulaValues = this.document.getMap<string>("formulaValues");

    const updates: Array<{ cellRef: string; values: string }> = [];

    for (const { cellRef } of this.trackedCellRefs) {
      const values = this.extractCellValues(yData, cellRef, yFormulaValues);
      if (values) {
        updates.push({ cellRef, values: JSON.stringify(values) });
      }
    }

    if (updates.length === 0) return;

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

  private extractCellValues(
    yData: Y.Array<Y.Map<string>>,
    cellRef: string,
    yFormulaValues?: Y.Map<string>,
  ): string[][] | null {
    if (cellRef.includes(":")) {
      const range = parseRange(cellRef);
      if (!range) return null;
      const result: string[][] = [];
      for (let r = range.startRow; r <= range.endRow && r < yData.length; r++) {
        const row: string[] = [];
        const rowMap = yData.get(r);
        for (let c = range.startCol; c <= range.endCol; c++) {
          const raw = rowMap?.get(String(c)) ?? "";
          row.push(resolveDisplayValue(raw, r, c, yFormulaValues));
        }
        result.push(row);
      }
      return result;
    } else {
      const cell = parseCellName(cellRef);
      if (!cell) return null;
      if (cell.row >= yData.length) return [[""]];
      const rowMap = yData.get(cell.row);
      const raw = rowMap?.get(String(cell.col)) ?? "";
      return [[resolveDisplayValue(raw, cell.row, cell.col, yFormulaValues)]];
    }
  }

  // ---------------------------------------------------------------------------
  // Document block reference observer (doc rooms only)
  // ---------------------------------------------------------------------------

  private setupBlockRefObserver(roomId: string): void {
    if (this.blockRefObserver) return; // Already attached

    const fragment = this.document.getXmlFragment("document-store");

    this.blockRefObserver = () => {
      if (this.blockRefPushTimeout) clearTimeout(this.blockRefPushTimeout);
      this.blockRefPushTimeout = setTimeout(() => {
        void this.pushBlockRefUpdates(roomId);
      }, BLOCK_REF_DEBOUNCE);
    };

    fragment.observeDeep(this.blockRefObserver);
    console.log(`Block ref observer attached for room ${roomId}`);
  }

  private async pushBlockRefUpdates(roomId: string): Promise<void> {
    const env = this.env as Env;
    const convexSiteUrl = env.CONVEX_SITE_URL;
    const secret = env.PARTYKIT_SECRET;
    if (!convexSiteUrl || !secret) return;

    const documentId = roomId.replace("doc-", "");

    // Fetch tracked block refs (with TTL caching)
    if (
      !this.trackedBlockRefs ||
      Date.now() - this.trackedBlockRefsLastFetch > BLOCK_REF_CACHE_TTL
    ) {
      try {
        const response = await fetch(
          `${convexSiteUrl}/collaboration/block-refs?documentId=${encodeURIComponent(documentId)}`,
          { headers: { Authorization: `Bearer ${secret}` } },
        );
        if (response.ok) {
          const refs: Array<{ blockId: string }> = await response.json();
          this.trackedBlockRefs = refs;
          this.trackedBlockRefsLastFetch = Date.now();
        }
      } catch (e) {
        console.error("Failed to fetch tracked block refs:", e);
        return;
      }
    }

    if (!this.trackedBlockRefs || this.trackedBlockRefs.length === 0) return;

    // Extract current block content from Yjs XML fragment
    const fragment = this.document.getXmlFragment("document-store");
    const allBlocks = extractBlocksFromFragment(fragment);
    const blockMap = new Map(allBlocks.map((b) => [b.blockId, b]));

    const updates: Array<{ blockId: string; blockType: string; textContent: string }> = [];

    for (const { blockId } of this.trackedBlockRefs) {
      const block = blockMap.get(blockId);
      if (block) {
        updates.push({
          blockId,
          blockType: block.type,
          textContent: block.text,
        });
      }
    }

    if (updates.length === 0) return;

    try {
      await fetch(`${convexSiteUrl}/collaboration/block-content`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId, updates }),
      });
    } catch (e) {
      console.error("Failed to push block ref updates:", e);
    }
  }

  /**
   * Flush any pending debounced ref updates before cleanup.
   * Ensures edits made just before disconnect are pushed to Convex.
   */
  private async flushPendingRefUpdates(roomId: string): Promise<void> {
    if (this.cellRefPushTimeout) {
      clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = null;
      await this.pushCellRefUpdates(roomId);
    }
    if (this.blockRefPushTimeout) {
      clearTimeout(this.blockRefPushTimeout);
      this.blockRefPushTimeout = null;
      await this.pushBlockRefUpdates(roomId);
    }
  }

  private cleanupBlockRefObserver(): void {
    if (this.blockRefObserver) {
      this.document.getXmlFragment("document-store").unobserveDeep(this.blockRefObserver);
      this.blockRefObserver = null;
    }
    if (this.blockRefPushTimeout) {
      clearTimeout(this.blockRefPushTimeout);
      this.blockRefPushTimeout = null;
    }
    this.trackedBlockRefs = null;
    this.trackedBlockRefsLastFetch = 0;
  }

  private cleanupCellRefObserver(): void {
    if (this.cellRefObserver) {
      this.document.getArray("data").unobserveDeep(this.cellRefObserver);
      this.cellRefObserver = null;
    }
    if (this.formulaValuesObserver) {
      this.document.getMap<string>("formulaValues").unobserve(this.formulaValuesObserver);
      this.formulaValuesObserver = null;
    }
    if (this.cellRefPushTimeout) {
      clearTimeout(this.cellRefPushTimeout);
      this.cellRefPushTimeout = null;
    }
    this.trackedCellRefs = null;
    this.trackedCellRefsLastFetch = 0;
  }
}
