import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 30;

/**
 * Spreadsheet cursor/selection state shared via Yjs Awareness.
 */
export interface SpreadsheetCursor {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface AwarenessState {
  user?: { name: string; color: string };
  cursor?: SpreadsheetCursor;
}

interface RemoteCursorOverlay {
  cells: HTMLElement[];
  label: HTMLElement | null;
}

/**
 * Two-way binding between a jspreadsheet-ce v5 worksheet and a Yjs document.
 *
 * Yjs document structure:
 *   "data"       → Y.Array<Y.Map<string>>    (rows of cells, Y.Map keys are col indices)
 *   "styles"     → Y.Map<string>             ("row,col" → CSS style)
 *   "colWidths"  → Y.Map<number>             (col index → width px)
 *   "rowHeights" → Y.Map<number>             (row index → height px)
 *   "merges"     → Y.Map<string>             (cellName → "colspan,rowspan")
 *   "meta"       → Y.Map<any>                ("colCount" → number)
 */
export class SpreadsheetYjsBinding {
  private worksheet: any;
  private yData: Y.Array<Y.Map<string>>;
  private yStyles: Y.Map<string>;
  private yColWidths: Y.Map<number>;
  private yRowHeights: Y.Map<number>;
  private yMerges: Y.Map<string>;
  private yMeta: Y.Map<any>;
  private awareness: Awareness | null;

  /** Guard flag to prevent feedback loops */
  private isApplyingRemote = false;

  private dataObserver: (events: Y.YEvent<any>[], tx: Y.Transaction) => void;
  private stylesObserver: (event: Y.YMapEvent<string>) => void;
  private colWidthsObserver: (event: Y.YMapEvent<number>) => void;
  private rowHeightsObserver: (event: Y.YMapEvent<number>) => void;
  private mergesObserver: (event: Y.YMapEvent<string>) => void;
  private awarenessHandler: ((change: { added: number[]; updated: number[]; removed: number[] }) => void) | null = null;

  private remoteCursors = new Map<number, RemoteCursorOverlay>();
  private styleElement: HTMLStyleElement | null = null;

  constructor(
    worksheet: any,
    yDoc: Y.Doc,
    awareness: Awareness | null,
    opts?: { defaultCols?: number; defaultRows?: number },
  ) {
    this.worksheet = worksheet;
    this.awareness = awareness;

    this.yData = yDoc.getArray<Y.Map<string>>("data");
    this.yStyles = yDoc.getMap<string>("styles");
    this.yColWidths = yDoc.getMap<number>("colWidths");
    this.yRowHeights = yDoc.getMap<number>("rowHeights");
    this.yMerges = yDoc.getMap<string>("merges");
    this.yMeta = yDoc.getMap<any>("meta");

    const defaultCols = opts?.defaultCols ?? DEFAULT_COLS;
    const defaultRows = opts?.defaultRows ?? DEFAULT_ROWS;

    if (this.yData.length === 0) {
      this.initializeYjsFromGrid(defaultRows, defaultCols);
    } else {
      this.loadGridFromYjs();
    }

    // Set up Yjs → jspreadsheet observers
    this.dataObserver = this.handleDataChange.bind(this);
    this.stylesObserver = this.handleStylesChange.bind(this);
    this.colWidthsObserver = this.handleColWidthsChange.bind(this);
    this.rowHeightsObserver = this.handleRowHeightsChange.bind(this);
    this.mergesObserver = this.handleMergesChange.bind(this);

    this.yData.observeDeep(this.dataObserver);
    this.yStyles.observe(this.stylesObserver);
    this.yColWidths.observe(this.colWidthsObserver);
    this.yRowHeights.observe(this.rowHeightsObserver);
    this.yMerges.observe(this.mergesObserver);

    if (this.awareness) {
      this.injectCursorStyles();
      this.awarenessHandler = this.handleAwarenessChange.bind(this);
      this.awareness.on("change", this.awarenessHandler);
      this.renderRemoteCursors();
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  private initializeYjsFromGrid(rows: number, cols: number) {
    this.yData.doc!.transact(() => {
      this.yMeta.set("colCount", cols);
      for (let r = 0; r < rows; r++) {
        const rowMap = new Y.Map<string>();
        for (let c = 0; c < cols; c++) {
          rowMap.set(String(c), "");
        }
        this.yData.push([rowMap]);
      }
    });
  }

  private loadGridFromYjs() {
    this.isApplyingRemote = true;
    try {
      const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
      const data: string[][] = [];
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        const row: string[] = [];
        for (let c = 0; c < colCount; c++) {
          row.push(rowMap.get(String(c)) ?? "");
        }
        data.push(row);
      }

      this.worksheet.setData(data);

      this.yColWidths.forEach((width: number, col: string) => {
        try { this.worksheet.setWidth(Number(col), width); } catch { /* */ }
      });
      this.yRowHeights.forEach((height: number, row: string) => {
        try { this.worksheet.setHeight(Number(row), height); } catch { /* */ }
      });
      this.yStyles.forEach((style: string, key: string) => {
        const [row, col] = key.split(",").map(Number);
        try { this.worksheet.setStyle(this.getCellName(col, row), style); } catch { /* */ }
      });
      this.yMerges.forEach((value: string, cellName: string) => {
        const [colspan, rowspan] = value.split(",").map(Number);
        try { this.worksheet.setMerge(cellName, colspan, rowspan); } catch { /* */ }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  // ---------------------------------------------------------------------------
  // jspreadsheet → Yjs  (local changes — called from event callbacks)
  //
  // All signatures match jspreadsheet-ce v5 typings.
  // ---------------------------------------------------------------------------

  /** v5: onchange(instance, cell, colIndex, rowIndex, newValue, oldValue) */
  onchange(
    _instance: any,
    _cell: any,
    colIndex: string | number,
    rowIndex: string | number,
    newValue: any,
  ) {
    if (this.isApplyingRemote) return;
    const col = Number(colIndex);
    const row = Number(rowIndex);
    if (row < this.yData.length) {
      const rowMap = this.yData.get(row);
      rowMap?.set(String(col), String(newValue ?? ""));
    }
  }

  /** v5: onafterchanges(instance, changes: CellChange[]) */
  onafterchanges(
    _instance: any,
    changes: Array<{ x: string; y: string; value: any }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!changes || changes.length === 0) return;
    this.yData.doc!.transact(() => {
      for (const c of changes) {
        const row = Number(c.y);
        const col = Number(c.x);
        if (row < this.yData.length) {
          const rowMap = this.yData.get(row);
          rowMap?.set(String(col), String(c.value ?? ""));
        }
      }
    });
  }

  /** v5: oninsertrow(instance, rows: { row: number; data: CellValue[] }[]) */
  oninsertrow(
    _instance: any,
    rows: Array<{ row: number; data: any[] }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!rows || rows.length === 0) return;
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;

    this.yData.doc!.transact(() => {
      // Rows are sorted by index; insert from lowest to highest
      const sorted = [...rows].sort((a, b) => a.row - b.row);
      for (let i = 0; i < sorted.length; i++) {
        const rowMap = new Y.Map<string>();
        for (let c = 0; c < colCount; c++) {
          rowMap.set(String(c), "");
        }
        this.yData.insert(sorted[i].row + i, [rowMap]);
      }
    });
  }

  /** v5: ondeleterow(instance, removedRows: number[]) */
  ondeleterow(
    _instance: any,
    removedRows: number[],
  ) {
    if (this.isApplyingRemote) return;
    if (!removedRows || removedRows.length === 0) return;

    this.yData.doc!.transact(() => {
      // Delete from highest index first to preserve lower indices
      const sorted = [...removedRows].sort((a, b) => b - a);
      for (const rowIdx of sorted) {
        if (rowIdx < this.yData.length) {
          this.yData.delete(rowIdx, 1);
        }
      }
    });
  }

  /** v5: oninsertcolumn(instance, columns: { column: number; options: any; data?: any[] }[]) */
  oninsertcolumn(
    _instance: any,
    columns: Array<{ column: number; options: any; data?: any[] }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!columns || columns.length === 0) return;
    const currentColCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    const numCols = columns.length;
    const insertAt = Math.min(...columns.map(c => c.column));

    this.yData.doc!.transact(() => {
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        // Shift existing columns right
        for (let c = currentColCount - 1; c >= insertAt; c--) {
          const val = rowMap.get(String(c)) ?? "";
          rowMap.set(String(c + numCols), val);
        }
        // Set new columns to empty
        for (let i = 0; i < numCols; i++) {
          rowMap.set(String(insertAt + i), "");
        }
      }
      this.yMeta.set("colCount", currentColCount + numCols);
    });
  }

  /** v5: ondeletecolumn(instance, removedColumns: number[]) */
  ondeletecolumn(
    _instance: any,
    removedColumns: number[],
  ) {
    if (this.isApplyingRemote) return;
    if (!removedColumns || removedColumns.length === 0) return;
    const currentColCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    const numCols = removedColumns.length;
    const deleteAt = Math.min(...removedColumns);

    this.yData.doc!.transact(() => {
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        // Shift columns left
        for (let c = deleteAt; c < currentColCount - numCols; c++) {
          const val = rowMap.get(String(c + numCols)) ?? "";
          rowMap.set(String(c), val);
        }
        // Remove trailing columns
        for (let c = currentColCount - numCols; c < currentColCount; c++) {
          rowMap.delete(String(c));
        }
      }
      this.yMeta.set("colCount", currentColCount - numCols);
    });
  }

  /** v5: onchangestyle(instance, changes: Record<string, string>) */
  onchangestyle(
    _instance: any,
    changes: Record<string, string>,
  ) {
    if (this.isApplyingRemote) return;
    if (!changes) return;
    this.yData.doc!.transact(() => {
      for (const [cellName, style] of Object.entries(changes)) {
        const coords = this.parseCellName(cellName);
        if (!coords) continue;
        const styleKey = `${coords.row},${coords.col}`;
        if (style) {
          this.yStyles.set(styleKey, style);
        } else {
          this.yStyles.delete(styleKey);
        }
      }
    });
  }

  /** v5: onresizecolumn(instance, colIndex, newWidth, oldWidth) */
  onresizecolumn(
    _instance: any,
    colIndex: number | number[],
    newWidth: number | number[],
  ) {
    if (this.isApplyingRemote) return;
    if (Array.isArray(colIndex)) {
      const widths = newWidth as number[];
      this.yData.doc!.transact(() => {
        for (let i = 0; i < colIndex.length; i++) {
          this.yColWidths.set(String(colIndex[i]), widths[i]);
        }
      });
    } else {
      this.yColWidths.set(String(colIndex), newWidth as number);
    }
  }

  /** v5: onresizerow(instance, rowIndex, newHeight, oldHeight) */
  onresizerow(
    _instance: any,
    rowIndex: number,
    newHeight: number,
  ) {
    if (this.isApplyingRemote) return;
    this.yRowHeights.set(String(rowIndex), newHeight);
  }

  /** v5: onmerge(instance, merges: Record<string, [number, number]>) */
  onmerge(
    _instance: any,
    merges: Record<string, [number, number]>,
  ) {
    if (this.isApplyingRemote) return;
    if (!merges) return;
    this.yData.doc!.transact(() => {
      for (const [cellName, [colspan, rowspan]] of Object.entries(merges)) {
        if (colspan <= 1 && rowspan <= 1) {
          this.yMerges.delete(cellName);
        } else {
          this.yMerges.set(cellName, `${colspan},${rowspan}`);
        }
      }
    });
  }

  /** v5: onselection(instance, x1, y1, x2, y2, origin) */
  onselection(
    _instance: any,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    if (!this.awareness) return;
    this.awareness.setLocalStateField("cursor", { x1, y1, x2, y2 } satisfies SpreadsheetCursor);
  }

  // ---------------------------------------------------------------------------
  // Yjs → jspreadsheet  (remote changes — observers)
  // ---------------------------------------------------------------------------

  private handleDataChange(events: Y.YEvent<any>[], tx: Y.Transaction) {
    if (tx.local) return;
    this.isApplyingRemote = true;
    try {
      for (const event of events) {
        if (event.target === this.yData) {
          this.applyRowChanges(event as Y.YArrayEvent<Y.Map<string>>);
        } else if (event.target instanceof Y.Map && event.target.parent === this.yData) {
          this.applyCellChanges(event as Y.YMapEvent<string>);
        }
      }
    } finally {
      this.isApplyingRemote = false;
    }
  }

  private applyRowChanges(event: Y.YArrayEvent<Y.Map<string>>) {
    let index = 0;
    for (const delta of event.changes.delta) {
      if (delta.retain) {
        index += delta.retain;
      } else if (delta.insert) {
        const rows = delta.insert as Y.Map<string>[];
        for (let i = 0; i < rows.length; i++) {
          try {
            this.worksheet.insertRow(1, index + i, true);
            const rowMap = rows[i];
            const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
            for (let c = 0; c < colCount; c++) {
              const val = rowMap.get(String(c)) ?? "";
              if (val) {
                this.worksheet.setValueFromCoords(c, index + i, val);
              }
            }
          } catch { /* */ }
        }
        index += rows.length;
      } else if (delta.delete) {
        try {
          this.worksheet.deleteRow(index, delta.delete);
        } catch { /* */ }
      }
    }
  }

  private applyCellChanges(event: Y.YMapEvent<string>) {
    const rowMap = event.target;
    let rowIndex = -1;
    for (let r = 0; r < this.yData.length; r++) {
      if (this.yData.get(r) === rowMap) {
        rowIndex = r;
        break;
      }
    }
    if (rowIndex === -1) return;

    event.changes.keys.forEach((change, key) => {
      if (change.action === "add" || change.action === "update") {
        const col = Number(key);
        const value = rowMap.get(key) ?? "";
        try { this.worksheet.setValueFromCoords(col, rowIndex, value); } catch { /* */ }
      }
    });
  }

  private handleStylesChange(event: Y.YMapEvent<string>) {
    if (event.transaction.local) return;
    this.isApplyingRemote = true;
    try {
      event.changes.keys.forEach((change, key) => {
        const [row, col] = key.split(",").map(Number);
        const cellName = this.getCellName(col, row);
        if (change.action === "add" || change.action === "update") {
          const style = this.yStyles.get(key);
          if (style) {
            try { this.worksheet.setStyle(cellName, style); } catch { /* */ }
          }
        } else if (change.action === "delete") {
          try { this.worksheet.setStyle(cellName, ""); } catch { /* */ }
        }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  private handleColWidthsChange(event: Y.YMapEvent<number>) {
    if (event.transaction.local) return;
    this.isApplyingRemote = true;
    try {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add" || change.action === "update") {
          const width = this.yColWidths.get(key);
          if (width !== undefined) {
            try { this.worksheet.setWidth(Number(key), width); } catch { /* */ }
          }
        }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  private handleRowHeightsChange(event: Y.YMapEvent<number>) {
    if (event.transaction.local) return;
    this.isApplyingRemote = true;
    try {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add" || change.action === "update") {
          const height = this.yRowHeights.get(key);
          if (height !== undefined) {
            try { this.worksheet.setHeight(Number(key), height); } catch { /* */ }
          }
        }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  private handleMergesChange(event: Y.YMapEvent<string>) {
    if (event.transaction.local) return;
    this.isApplyingRemote = true;
    try {
      event.changes.keys.forEach((change, cellName) => {
        if (change.action === "add" || change.action === "update") {
          const value = this.yMerges.get(cellName);
          if (value) {
            const [colspan, rowspan] = value.split(",").map(Number);
            try { this.worksheet.setMerge(cellName, colspan, rowspan); } catch { /* */ }
          }
        } else if (change.action === "delete") {
          try { this.worksheet.removeMerge(cellName); } catch { /* */ }
        }
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Remote cursor awareness
  // ---------------------------------------------------------------------------

  private injectCursorStyles() {
    this.styleElement = document.createElement("style");
    this.styleElement.textContent = `
      .jss-remote-cursor-label {
        position: absolute;
        top: -18px;
        left: -1px;
        font-size: 11px;
        line-height: 16px;
        padding: 0 4px;
        border-radius: 3px 3px 3px 0;
        color: #fff;
        white-space: nowrap;
        pointer-events: none;
        z-index: 10;
        font-family: system-ui, sans-serif;
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private handleAwarenessChange() {
    this.renderRemoteCursors();
  }

  private renderRemoteCursors() {
    if (!this.awareness) return;

    const states = this.awareness.getStates();
    const localClientId = this.awareness.clientID;
    const activeClientIds = new Set<number>();

    states.forEach((state: AwarenessState, clientId: number) => {
      if (clientId === localClientId) return;
      if (!state.user || !state.cursor) return;

      activeClientIds.add(clientId);
      const { cursor, user } = state;

      this.clearRemoteCursor(clientId);

      const table = this.getWorksheetTable();
      if (!table) return;

      const overlay: RemoteCursorOverlay = { cells: [], label: null };
      const minRow = Math.min(cursor.y1, cursor.y2);
      const maxRow = Math.max(cursor.y1, cursor.y2);
      const minCol = Math.min(cursor.x1, cursor.x2);
      const maxCol = Math.max(cursor.x1, cursor.x2);

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const td = this.getCellElement(table, r, c);
          if (td) {
            // Only draw borders on outer edges of selection
            const shadows: string[] = [];
            if (r === minRow) shadows.push(`inset 0 2px 0 0 ${user.color}`);
            if (r === maxRow) shadows.push(`inset 0 -2px 0 0 ${user.color}`);
            if (c === minCol) shadows.push(`inset 2px 0 0 0 ${user.color}`);
            if (c === maxCol) shadows.push(`inset -2px 0 0 0 ${user.color}`);
            td.style.boxShadow = shadows.join(", ");
            td.style.backgroundColor = this.hexToRgba(user.color, 0.08);
            overlay.cells.push(td);
          }
        }
      }

      const topLeftTd = this.getCellElement(table, minRow, minCol);
      if (topLeftTd) {
        const label = document.createElement("div");
        label.className = "jss-remote-cursor-label";
        label.style.backgroundColor = user.color;
        label.textContent = user.name;
        topLeftTd.style.position = "relative";
        topLeftTd.appendChild(label);
        overlay.label = label;
      }

      this.remoteCursors.set(clientId, overlay);
    });

    for (const [clientId] of this.remoteCursors) {
      if (!activeClientIds.has(clientId)) {
        this.clearRemoteCursor(clientId);
        this.remoteCursors.delete(clientId);
      }
    }
  }

  private clearRemoteCursor(clientId: number) {
    const overlay = this.remoteCursors.get(clientId);
    if (!overlay) return;
    for (const cell of overlay.cells) {
      cell.style.boxShadow = "";
      cell.style.backgroundColor = "";
    }
    if (overlay.label) {
      overlay.label.remove();
    }
  }

  private getWorksheetTable(): HTMLElement | null {
    const el = this.worksheet?.element || this.worksheet?.el;
    if (!el) return null;
    return el.querySelector(".jss_worksheet") ?? el.closest(".jss_worksheet") ?? el;
  }

  private getCellElement(table: HTMLElement, row: number, col: number): HTMLElement | null {
    const tbody = table.querySelector("tbody");
    if (!tbody) return null;
    const tr = tbody.children[row] as HTMLElement | undefined;
    if (!tr) return null;
    return (tr.children[col + 1] as HTMLElement) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private getCellName(col: number, row: number): string {
    let name = "";
    let c = col;
    do {
      name = String.fromCharCode(65 + (c % 26)) + name;
      c = Math.floor(c / 26) - 1;
    } while (c >= 0);
    return name + (row + 1);
  }

  private parseCellName(cellName: string): { col: number; row: number } | null {
    const match = cellName.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    let col = 0;
    for (let i = 0; i < match[1].length; i++) {
      col = col * 26 + (match[1].charCodeAt(i) - 64);
    }
    col -= 1;
    const row = parseInt(match[2], 10) - 1;
    return { col, row };
  }

  private hexToRgba(hex: string, alpha: number): string {
    const cleanHex = hex.replace("#", "");
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy() {
    this.yData.unobserveDeep(this.dataObserver);
    this.yStyles.unobserve(this.stylesObserver);
    this.yColWidths.unobserve(this.colWidthsObserver);
    this.yRowHeights.unobserve(this.rowHeightsObserver);
    this.yMerges.unobserve(this.mergesObserver);

    if (this.awareness && this.awarenessHandler) {
      this.awareness.off("change", this.awarenessHandler);
    }

    for (const [clientId] of this.remoteCursors) {
      this.clearRemoteCursor(clientId);
    }
    this.remoteCursors.clear();

    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}
