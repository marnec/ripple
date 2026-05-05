import type { Awareness } from "y-protocols/awareness";
import type { AwarenessUser } from "@/lib/awareness-types";
import {
  getCellElement,
  getWorksheetTable,
  hexToRgba,
} from "@/lib/spreadsheet-table-viewport";

export interface SpreadsheetCursor {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface AwarenessState {
  user?: AwarenessUser;
  cursor?: SpreadsheetCursor;
}

interface RemoteCursorOverlay {
  cells: HTMLElement[];
  label: HTMLElement | null;
  labelHost: HTMLElement | null;
  labelTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Renders peer selection rectangles + name labels into the jspreadsheet `<td>`s
 * by reading Yjs `Awareness` state. rAF-coalesces awareness change bursts so a
 * room with many concurrent edits doesn't trigger a render per packet.
 *
 * Owns its own DOM mutations and cleanup; callers only need `setActiveClients`
 * to filter out users that have left the facepile.
 */
export class SpreadsheetRemoteCursors {
  private remoteCursors = new Map<number, RemoteCursorOverlay>();
  /** Last rendered cursor state per remote client, for dirty-checking. */
  private lastCursorState = new Map<number, string>();
  /** Active clients per the facepile; cursors for non-active clients are removed. */
  private activeClientIds: Set<number> | null = null;

  private cursorRafId: number | null = null;
  private readonly awarenessHandler: () => void;

  constructor(
    private readonly worksheet: unknown,
    private readonly awareness: Awareness,
  ) {
    this.awarenessHandler = this.handleAwarenessChange.bind(this);
    this.awareness.on("change", this.awarenessHandler);
    this.render();
  }

  setActiveClients(ids: Set<number>) {
    this.activeClientIds = ids;
    this.render();
  }

  private handleAwarenessChange() {
    if (this.cursorRafId !== null) return;
    this.cursorRafId = requestAnimationFrame(() => {
      this.cursorRafId = null;
      this.render();
    });
  }

  private render() {
    const table = getWorksheetTable(this.worksheet);
    if (!table) return;

    const states = this.awareness.getStates();
    const localClientId = this.awareness.clientID;
    const stillActive = new Set<number>();

    states.forEach((state: AwarenessState, clientId: number) => {
      if (clientId === localClientId) return;
      if (!state.user || !state.cursor) return;
      if (this.activeClientIds && !this.activeClientIds.has(clientId)) return;

      stillActive.add(clientId);
      const { cursor, user } = state;

      const stateKey = `${cursor.x1},${cursor.y1},${cursor.x2},${cursor.y2},${user.color}`;
      if (this.lastCursorState.get(clientId) === stateKey && this.remoteCursors.has(clientId)) {
        return;
      }
      this.lastCursorState.set(clientId, stateKey);

      this.clearOne(clientId);

      const overlay: RemoteCursorOverlay = { cells: [], label: null, labelHost: null, labelTimer: null };
      const minRow = Math.min(cursor.y1, cursor.y2);
      const maxRow = Math.max(cursor.y1, cursor.y2);
      const minCol = Math.min(cursor.x1, cursor.x2);
      const maxCol = Math.max(cursor.x1, cursor.x2);

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const td = getCellElement(table, r, c);
          if (!td) continue;
          const shadows: string[] = [];
          if (r === minRow) shadows.push(`inset 0 2px 0 0 ${user.color}`);
          if (r === maxRow) shadows.push(`inset 0 -2px 0 0 ${user.color}`);
          if (c === minCol) shadows.push(`inset 2px 0 0 0 ${user.color}`);
          if (c === maxCol) shadows.push(`inset -2px 0 0 0 ${user.color}`);
          td.style.boxShadow = shadows.join(", ");
          td.style.backgroundColor = hexToRgba(user.color, 0.08);
          overlay.cells.push(td);
        }
      }

      const topLeftTd = getCellElement(table, minRow, minCol);
      if (topLeftTd) {
        const label = document.createElement("div");
        label.className = "jss-remote-cursor-label";
        label.style.backgroundColor = user.color;
        label.textContent = user.name;
        topLeftTd.style.position = "relative";
        topLeftTd.style.overflow = "visible";
        topLeftTd.appendChild(label);
        overlay.label = label;
        overlay.labelHost = topLeftTd;
        overlay.labelTimer = setTimeout(() => {
          label.classList.add("jss-label-hidden");
        }, 2000);
      }

      this.remoteCursors.set(clientId, overlay);
    });

    for (const [clientId] of this.remoteCursors) {
      if (!stillActive.has(clientId)) {
        this.clearOne(clientId);
        this.remoteCursors.delete(clientId);
        this.lastCursorState.delete(clientId);
      }
    }
  }

  private clearOne(clientId: number) {
    const overlay = this.remoteCursors.get(clientId);
    if (!overlay) return;
    for (const cell of overlay.cells) {
      cell.style.boxShadow = "";
      cell.style.backgroundColor = "";
    }
    if (overlay.labelTimer) clearTimeout(overlay.labelTimer);
    if (overlay.label) overlay.label.remove();
    if (overlay.labelHost) {
      overlay.labelHost.style.overflow = "";
      overlay.labelHost.style.position = "";
    }
  }

  destroy() {
    this.awareness.off("change", this.awarenessHandler);
    if (this.cursorRafId !== null) cancelAnimationFrame(this.cursorRafId);
    for (const [clientId] of this.remoteCursors) this.clearOne(clientId);
    this.remoteCursors.clear();
    this.lastCursorState.clear();
  }
}
