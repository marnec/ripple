import { isSingleCell, parseCellName, parseRange } from "@shared/cellRef";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 30;

/**
 * Idempotent template update for initializing empty spreadsheets.
 * Uses a fixed Yjs client ID so applying it multiple times (or from different
 * clients) is a no-op — prevents Y.Array row accumulation from concurrent init.
 */
const EMPTY_SPREADSHEET_UPDATE: Uint8Array = (() => {
  const doc = new Y.Doc();
  doc.clientID = 1; // Fixed ID → applying this update is always idempotent
  const data = doc.getArray<Y.Map<string>>("data");
  const meta = doc.getMap<any>("meta");
  doc.transact(() => {
    meta.set("colCount", DEFAULT_COLS);
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const rowMap = new Y.Map<string>();
      for (let c = 0; c < DEFAULT_COLS; c++) {
        rowMap.set(String(c), "");
      }
      data.push([rowMap]);
    }
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
})();

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
  labelHost: HTMLElement | null;
  labelTimer: ReturnType<typeof setTimeout> | null;
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
 *   "meta"           → Y.Map<any>                ("colCount" → number)
 *   "formulaValues"  → Y.Map<string>             ("row,col" → computed display value)
 */
export class SpreadsheetYjsBinding {
  private worksheet: any;
  private yData: Y.Array<Y.Map<string>>;
  private yStyles: Y.Map<string>;
  private yColWidths: Y.Map<number>;
  private yRowHeights: Y.Map<number>;
  private yMerges: Y.Map<string>;
  private yMeta: Y.Map<any>;
  private yFormulaValues: Y.Map<string>;
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

  /** Throttle: pending selection for rAF-based awareness broadcast */
  private pendingSelection: SpreadsheetCursor | null = null;
  private selectionRafId: number | null = null;

  /** Throttle: pending rAF id for cursor rendering */
  private cursorRafId: number | null = null;

  /** Cache: Y.Map → row index for fast lookups in applyCellChanges */
  private rowIndexCache = new WeakMap<Y.Map<string>, number>();

  /** Cache: last rendered cursor state per remote client (for dirty-checking) */
  private lastCursorState = new Map<number, string>();

  /** Set of remote client IDs considered "active" by the facepile.
   *  When set, cursors for clients not in this set are removed. */
  private activeClientIds: Set<number> | null = null;

  /** Currently highlighted cells (for efficient cleanup) */
  private highlightedCells: HTMLElement[] = [];

  /** Currently highlighted indicator cells (top-right cells with corner triangle) */
  private indicatorCells: HTMLElement[] = [];

  /** Stored cell refs from the server */
  private referencedCellRefs: { cellRef: string }[] = [];

  /** Set of "row,col" keys for cells containing formulas */
  private formulaCells = new Set<string>();

  /** Pending deferred formula refresh timer */
  private formulaRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    worksheet: any,
    yDoc: Y.Doc,
    awareness: Awareness | null,
  ) {
    this.worksheet = worksheet;
    this.awareness = awareness;

    this.yData = yDoc.getArray<Y.Map<string>>("data");
    this.yStyles = yDoc.getMap<string>("styles");
    this.yColWidths = yDoc.getMap<number>("colWidths");
    this.yRowHeights = yDoc.getMap<number>("rowHeights");
    this.yMerges = yDoc.getMap<string>("merges");
    this.yMeta = yDoc.getMap<any>("meta");
    this.yFormulaValues = yDoc.getMap<string>("formulaValues");

    // Idempotent init: applying the same fixed-clientID update is a no-op if
    // already present, so concurrent clients can't duplicate rows.
    if (this.yData.length === 0) {
      Y.applyUpdate(yDoc, EMPTY_SPREADSHEET_UPDATE);
    }

    // Compact rows accumulated by the previous (non-idempotent) init bug.
    if (this.yData.length > DEFAULT_ROWS) {
      this.compactRows();
    }

    this.loadGridFromYjs();

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

    this.injectStyles();

    if (this.awareness) {
      this.awarenessHandler = this.handleAwarenessChange.bind(this);
      this.awareness.on("change", this.awarenessHandler);
      this.renderRemoteCursors();
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /** Remove trailing empty rows beyond DEFAULT_ROWS (fixes prior accumulation bug). */
  private compactRows() {
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    let lastNonEmpty = DEFAULT_ROWS - 1;

    for (let r = this.yData.length - 1; r >= DEFAULT_ROWS; r--) {
      const rowMap = this.yData.get(r);
      let hasContent = false;
      for (let c = 0; c < colCount; c++) {
        if (rowMap.get(String(c))) {
          hasContent = true;
          break;
        }
      }
      if (hasContent) {
        lastNonEmpty = r;
        break;
      }
    }

    const keepRows = lastNonEmpty + 1;
    if (this.yData.length > keepRows) {
      this.yData.doc!.transact(() => {
        this.yData.delete(keepRows, this.yData.length - keepRows);
      });
    }
  }

  /** Lazily grow yData to include the given row index (for edits beyond current range). */
  private ensureRows(upToIndex: number) {
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    while (this.yData.length <= upToIndex) {
      const rowMap = new Y.Map<string>();
      for (let c = 0; c < colCount; c++) {
        rowMap.set(String(c), "");
      }
      this.yData.push([rowMap]);
      this.rowIndexCache.set(rowMap, this.yData.length - 1);
    }
  }

  private loadGridFromYjs() {
    this.isApplyingRemote = true;
    try {
      const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
      const data: string[][] = [];
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        this.rowIndexCache.set(rowMap, r);
        const row: string[] = [];
        for (let c = 0; c < colCount; c++) {
          row.push(rowMap.get(String(c)) ?? "");
        }
        data.push(row);
      }

      this.worksheet.setData(data);

      // Build initial formula cell tracking set
      this.formulaCells.clear();
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          if (data[r][c].startsWith("=")) {
            this.formulaCells.add(`${r},${c}`);
          }
        }
      }

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

    // Capture formula display values after jspreadsheet finishes evaluation
    if (this.formulaCells.size > 0) {
      this.scheduleFormulaRefresh();
    }

    this.renderCellRefHighlights();
  }

  // ---------------------------------------------------------------------------
  // jspreadsheet → Yjs  (local changes — called from event callbacks)
  //
  // All signatures match jspreadsheet-ce v5 typings.
  // ---------------------------------------------------------------------------

  /** v5: onchange — intentionally a no-op. onafterchanges handles all cell
   *  edits in a single Yjs transaction, avoiding double-writes. */
  onchange() {}

  /** v5: onafterchanges(instance, changes: CellChange[]) */
  onafterchanges(
    _instance: any,
    changes: Array<{ x: string; y: string; value: any }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!changes || changes.length === 0) return;
    this.yData.doc!.transact(() => {
      const maxRow = Math.max(...changes.map(c => Number(c.y)));
      this.ensureRows(maxRow);
      for (const c of changes) {
        const row = Number(c.y);
        const col = Number(c.x);
        const rowMap = this.yData.get(row);
        rowMap?.set(String(col), String(c.value ?? ""));
      }
    });

    // Track formula cells and refresh computed display values.
    // Any change may cascade to dependent formula cells, so always refresh.
    for (const c of changes) {
      this.updateFormulaCellTracking(Number(c.y), Number(c.x), String(c.value ?? ""));
    }
    this.scheduleFormulaRefresh();
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
        const insertAt = sorted[i].row + i;
        // Grow yData if the insert position is beyond current length
        this.ensureRows(insertAt > 0 ? insertAt - 1 : 0);
        const rowMap = new Y.Map<string>();
        for (let c = 0; c < colCount; c++) {
          rowMap.set(String(c), "");
        }
        this.yData.insert(insertAt, [rowMap]);
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

  /** v5: onselection(instance, x1, y1, x2, y2, origin)
   *  Throttled via rAF to avoid flooding awareness during drag-select. */
  onselection(
    _instance: any,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    if (!this.awareness) return;
    this.pendingSelection = { x1, y1, x2, y2 };
    if (this.selectionRafId === null) {
      this.selectionRafId = requestAnimationFrame(() => {
        this.selectionRafId = null;
        if (this.pendingSelection && this.awareness) {
          this.awareness.setLocalStateField("cursor", this.pendingSelection);
          this.pendingSelection = null;
        }
      });
    }
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
    // Remote data changes may trigger formula recalculation in jspreadsheet
    this.scheduleFormulaRefresh();
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
    // Rebuild row index cache and formula tracking after structural changes
    this.rebuildRowIndexCache();
    this.rebuildFormulaCellTracking();
    this.renderCellRefHighlights();
  }

  private rebuildRowIndexCache() {
    for (let r = 0; r < this.yData.length; r++) {
      this.rowIndexCache.set(this.yData.get(r), r);
    }
  }

  private applyCellChanges(event: Y.YMapEvent<string>) {
    const rowMap = event.target;
    const rowIndex = this.rowIndexCache.get(rowMap) ?? -1;
    if (rowIndex === -1) return;

    event.changes.keys.forEach((change, key) => {
      if (change.action === "add" || change.action === "update") {
        const col = Number(key);
        const value = rowMap.get(key) ?? "";
        try { this.worksheet.setValueFromCoords(col, rowIndex, value); } catch { /* */ }
        this.updateFormulaCellTracking(rowIndex, col, value);
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

  /** Update the set of active remote client IDs (mirrors the facepile).
   *  Cursors for clients not in this set will be removed. */
  setActiveClients(ids: Set<number>) {
    this.activeClientIds = ids;
    this.renderRemoteCursors();
  }

  /** Update the set of cell refs referenced by documents. Triggers re-render of highlights. */
  setReferencedCells(refs: { cellRef: string }[]) {
    this.referencedCellRefs = refs;
    this.renderCellRefHighlights();
  }

  private renderCellRefHighlights() {
    const table = this.getWorksheetTable();
    if (!table) return;

    this.clearCellRefHighlights();

    for (const { cellRef } of this.referencedCellRefs) {
      if (isSingleCell(cellRef)) {
        const coords = parseCellName(cellRef);
        if (!coords) continue;

        const td = this.getCellElement(table, coords.row, coords.col);
        if (td) {
          td.classList.add("jss-cell-ref-highlight", "jss-cell-ref-indicator");
          this.highlightedCells.push(td);
          this.indicatorCells.push(td);
        }
      } else {
        const range = parseRange(cellRef);
        if (!range) continue;

        for (let r = range.startRow; r <= range.endRow; r++) {
          for (let c = range.startCol; c <= range.endCol; c++) {
            const td = this.getCellElement(table, r, c);
            if (td) {
              td.classList.add("jss-cell-ref-highlight");
              this.highlightedCells.push(td);
            }
          }
        }

        // Indicator on top-right cell (avoids collision with cursor labels on top-left)
        const topRightTd = this.getCellElement(table, range.startRow, range.endCol);
        if (topRightTd) {
          topRightTd.classList.add("jss-cell-ref-indicator");
          this.indicatorCells.push(topRightTd);
        }
      }
    }
  }

  private clearCellRefHighlights() {
    for (const cell of this.highlightedCells) {
      cell.classList.remove("jss-cell-ref-highlight");
    }
    for (const cell of this.indicatorCells) {
      cell.classList.remove("jss-cell-ref-indicator");
    }
    this.highlightedCells = [];
    this.indicatorCells = [];
  }

  private injectStyles() {
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
        opacity: 1;
        transition: opacity 0.3s ease;
      }
      .jss-remote-cursor-label.jss-label-hidden {
        opacity: 0;
      }
      .jss-cell-ref-highlight {
        background-color: rgba(251, 191, 36, 0.12) !important;
      }
      .jss-cell-ref-indicator {
        position: relative !important;
        overflow: visible !important;
      }
      .jss-cell-ref-indicator::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 0 6px 6px 0;
        border-color: transparent #f59e0b transparent transparent;
        pointer-events: none;
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private handleAwarenessChange() {
    // Coalesce rapid awareness updates into a single render pass
    if (this.cursorRafId === null) {
      this.cursorRafId = requestAnimationFrame(() => {
        this.cursorRafId = null;
        this.renderRemoteCursors();
      });
    }
  }

  private renderRemoteCursors() {
    if (!this.awareness) return;

    const table = this.getWorksheetTable();
    if (!table) return;

    const states = this.awareness.getStates();
    const localClientId = this.awareness.clientID;
    const activeClientIds = new Set<number>();

    states.forEach((state: AwarenessState, clientId: number) => {
      if (clientId === localClientId) return;
      if (!state.user || !state.cursor) return;
      // Skip clients that are no longer shown in the facepile (stale)
      if (this.activeClientIds && !this.activeClientIds.has(clientId)) return;

      activeClientIds.add(clientId);
      const { cursor, user } = state;

      // Dirty check: skip full teardown/rebuild if cursor hasn't moved
      const stateKey = `${cursor.x1},${cursor.y1},${cursor.x2},${cursor.y2},${user.color}`;
      if (this.lastCursorState.get(clientId) === stateKey && this.remoteCursors.has(clientId)) {
        return;
      }
      this.lastCursorState.set(clientId, stateKey);

      this.clearRemoteCursor(clientId);

      const overlay: RemoteCursorOverlay = { cells: [], label: null, labelHost: null, labelTimer: null };
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
      if (!activeClientIds.has(clientId)) {
        this.clearRemoteCursor(clientId);
        this.remoteCursors.delete(clientId);
        this.lastCursorState.delete(clientId);
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
    if (overlay.labelTimer) {
      clearTimeout(overlay.labelTimer);
    }
    if (overlay.label) {
      overlay.label.remove();
    }
    if (overlay.labelHost) {
      overlay.labelHost.style.overflow = "";
      overlay.labelHost.style.position = "";
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
  // Formula value tracking
  //
  // Captures computed display values for formula cells (those starting with "=")
  // and stores them in the "formulaValues" Y.Map so server-side extraction
  // functions (PartyKit + Convex) can read computed values instead of raw formulas.
  // ---------------------------------------------------------------------------

  /** Track or untrack a cell as a formula cell based on its value. */
  private updateFormulaCellTracking(row: number, col: number, value: string) {
    const key = `${row},${col}`;
    if (typeof value === "string" && value.startsWith("=")) {
      this.formulaCells.add(key);
    } else {
      this.formulaCells.delete(key);
    }
  }

  /** Full scan to rebuild formula cell tracking after structural changes (row/col insert/delete). */
  private rebuildFormulaCellTracking() {
    this.formulaCells.clear();
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    for (let r = 0; r < this.yData.length; r++) {
      const rowMap = this.yData.get(r);
      for (let c = 0; c < colCount; c++) {
        const val = rowMap.get(String(c)) ?? "";
        if (val.startsWith("=")) {
          this.formulaCells.add(`${r},${c}`);
        }
      }
    }
  }

  /**
   * Schedule a deferred formula display value refresh.
   * Uses setTimeout(0) to run after jspreadsheet finishes evaluating formulas
   * and after the current Yjs transaction completes.
   */
  private scheduleFormulaRefresh() {
    if (this.formulaRefreshTimer !== null) {
      clearTimeout(this.formulaRefreshTimer);
    }
    this.formulaRefreshTimer = setTimeout(() => {
      this.formulaRefreshTimer = null;
      this.refreshFormulaDisplayValues();
    }, 0);
  }

  /**
   * Read computed display values for all tracked formula cells and update
   * the yFormulaValues map. Uses jspreadsheet's getValueFromCoords(x, y, true)
   * to get the processed (computed) value rather than the raw formula.
   */
  private refreshFormulaDisplayValues() {
    if (!this.worksheet) return;

    const updates: Array<[string, string]> = [];
    const removals: string[] = [];

    for (const key of this.formulaCells) {
      const [rowStr, colStr] = key.split(",");
      const row = Number(rowStr);
      const col = Number(colStr);

      let displayValue: string;
      try {
        const val = this.worksheet.getValueFromCoords(col, row, true);
        displayValue = val != null ? String(val) : "";
      } catch {
        continue;
      }

      const current = this.yFormulaValues.get(key);
      if (current !== displayValue) {
        updates.push([key, displayValue]);
      }
    }

    // Clean up entries for cells no longer containing formulas
    this.yFormulaValues.forEach((_value: string, key: string) => {
      if (!this.formulaCells.has(key)) {
        removals.push(key);
      }
    });

    if (updates.length === 0 && removals.length === 0) return;

    this.yData.doc!.transact(() => {
      for (const [key, value] of updates) {
        this.yFormulaValues.set(key, value);
      }
      for (const key of removals) {
        this.yFormulaValues.delete(key);
      }
    });
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

    // Cancel pending timers and rAF callbacks
    if (this.formulaRefreshTimer !== null) clearTimeout(this.formulaRefreshTimer);
    if (this.selectionRafId !== null) cancelAnimationFrame(this.selectionRafId);
    if (this.cursorRafId !== null) cancelAnimationFrame(this.cursorRafId);

    this.clearCellRefHighlights();

    for (const [clientId] of this.remoteCursors) {
      this.clearRemoteCursor(clientId);
    }
    this.remoteCursors.clear();
    this.lastCursorState.clear();

    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}
