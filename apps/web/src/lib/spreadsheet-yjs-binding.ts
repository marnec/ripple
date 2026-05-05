import type { Awareness } from "y-protocols/awareness";
import { type ShiftOp } from "@/lib/formulaShift";
import { planFormulaShift } from "@/lib/planFormulaShift";
import { SpreadsheetFormulaTracker } from "@/lib/spreadsheet-formula-tracker";
import { SpreadsheetOverlayManager } from "@/lib/spreadsheet-overlay-manager";
import { SpreadsheetRemoteCursors } from "@/lib/spreadsheet-remote-cursors";
import { ensureSpreadsheetStyles } from "@/lib/spreadsheet-table-viewport";
import * as Y from "yjs";

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 30;

/** Safe `String(v)` for jspreadsheet-supplied cell values, which are typed as
 *  `unknown` in our wrapper but in practice always primitives. Returns "" for
 *  anything non-stringifiable rather than the `[object Object]` default. */
function stringifyCellValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Coerce a value from an imported spreadsheet (TabularJS) into a cell string.
 *  Numbers/booleans stringify naturally; Date → ISO; objects/arrays drop. */
function stringifyImportedCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return "";
}

/**
 * Idempotent template update for initializing empty spreadsheets. Uses a fixed
 * Yjs client ID so applying it multiple times (or from different clients) is
 * a no-op — prevents Y.Array row accumulation from concurrent init.
 *
 * Seeds `rowOrder` and `colOrder` with deterministic IDs (`r0..rN`, `c0..cN`)
 * so concurrent bootstrap from multiple clients produces identical arrays.
 */
const EMPTY_SPREADSHEET_UPDATE: Uint8Array = (() => {
  const doc = new Y.Doc();
  doc.clientID = 1; // Fixed ID → applying this update is always idempotent
  const data = doc.getArray<Y.Map<string>>("data");
  const meta = doc.getMap<unknown>("meta");
  const rowOrder = doc.getArray<string>("rowOrder");
  const colOrder = doc.getArray<string>("colOrder");
  doc.transact(() => {
    meta.set("colCount", DEFAULT_COLS);
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const rowMap = new Y.Map<string>();
      for (let c = 0; c < DEFAULT_COLS; c++) {
        rowMap.set(String(c), "");
      }
      data.push([rowMap]);
    }
    for (let r = 0; r < DEFAULT_ROWS; r++) rowOrder.push([`r${r}`]);
    for (let c = 0; c < DEFAULT_COLS; c++) colOrder.push([`c${c}`]);
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
})();

/**
 * Generate a fresh stable row/col ID for runtime mutations (post-bootstrap).
 * Format: `<prefix><random36><timestamp36>` — collision-free vs bootstrap IDs
 * which use the simpler `<prefix><integer>` form.
 */
function makeStableId(prefix: "r" | "c"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`;
}

/**
 * Two-way binding between a jspreadsheet-ce v5 worksheet and a Yjs document.
 *
 * Yjs document structure:
 *   "data"          → Y.Array<Y.Map<string>>    (rows of cells, Y.Map keys are col indices)
 *   "styles"        → Y.Map<string>             ("row,col" → CSS style)
 *   "colWidths"     → Y.Map<number>             (col index → width px)
 *   "rowHeights"    → Y.Map<number>             (row index → height px)
 *   "merges"        → Y.Map<string>             (cellName → "colspan,rowspan")
 *   "meta"          → Y.Map<unknown>            ("colCount" → number)
 *   "formulaValues" → Y.Map<string>             ("row,col" → computed display value)
 *
 * The class is a thin coordinator. Subsystems own their state:
 *   - `SpreadsheetOverlayManager`   → ref + edit highlights
 *   - `SpreadsheetRemoteCursors`    → awareness-driven peer cursors
 *   - `SpreadsheetFormulaTracker`   → formula cell set + computed value cache
 *
 * The binding itself owns: data observers, undo manager, origin tagging,
 * subscriber fan-out for `useSyncExternalStore`, and structural-change wiring
 * (insert/delete row/col with formula ref shifting).
 */
export class SpreadsheetYjsBinding {
  // jspreadsheet-ce doesn't export worksheet instance type cleanly.
  private worksheet: any;
  private yData: Y.Array<Y.Map<string>>;
  private yStyles: Y.Map<string>;
  private yColWidths: Y.Map<number>;
  private yRowHeights: Y.Map<number>;
  private yMerges: Y.Map<string>;
  private yMeta: Y.Map<unknown>;
  private yFormulaValues: Y.Map<string>;
  private yRowOrder: Y.Array<string>;
  private yColOrder: Y.Array<string>;

  /** Guard flag to prevent feedback loops between Yjs observers and jspreadsheet edits. */
  private isApplyingRemote = false;

  private dataObserver: (events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) => void;
  private stylesObserver: (event: Y.YMapEvent<string>) => void;
  private colWidthsObserver: (event: Y.YMapEvent<number>) => void;
  private rowHeightsObserver: (event: Y.YMapEvent<number>) => void;
  private mergesObserver: (event: Y.YMapEvent<string>) => void;

  /** Throttle: pending selection for rAF-based awareness broadcast */
  private pendingSelection: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private selectionRafId: number | null = null;

  /** Cache: Y.Map → row index for fast lookups in applyCellChanges */
  private rowIndexCache = new WeakMap<Y.Map<string>, number>();

  /** External listeners (formula bar) notified on any yData change. */
  private subscribers = new Set<() => void>();

  /** Origin tag stamped on all transactions originating from this client's
   *  user-driven edits (in-cell + formula bar). Y.UndoManager uses this as
   *  the only tracked origin, so remote edits and observer-driven replays
   *  are excluded from the undo stack. */
  private localWriteOrigin = Symbol("ripple-spreadsheet-local-write");

  /** Yjs-native undo/redo. Replaces jspreadsheet's internal history so the
   *  grid and the Yjs doc never diverge on Ctrl+Z. */
  private undoManager!: Y.UndoManager;

  // Subsystems
  private overlays: SpreadsheetOverlayManager;
  private cursors: SpreadsheetRemoteCursors | null;
  private formulaTracker: SpreadsheetFormulaTracker;

  private awareness: Awareness | null;

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
    this.yMeta = yDoc.getMap<unknown>("meta");
    this.yFormulaValues = yDoc.getMap<string>("formulaValues");
    this.yRowOrder = yDoc.getArray<string>("rowOrder");
    this.yColOrder = yDoc.getArray<string>("colOrder");

    // Idempotent init — concurrent clients can't duplicate rows.
    if (this.yData.length === 0) {
      Y.applyUpdate(yDoc, EMPTY_SPREADSHEET_UPDATE);
    }

    // Compact rows accumulated by the previous (non-idempotent) init bug.
    if (this.yData.length > DEFAULT_ROWS) this.compactRows();

    ensureSpreadsheetStyles();

    this.overlays = new SpreadsheetOverlayManager(worksheet);
    this.cursors = awareness ? new SpreadsheetRemoteCursors(worksheet, awareness) : null;
    this.formulaTracker = new SpreadsheetFormulaTracker({
      yData: this.yData,
      yMeta: this.yMeta,
      yFormulaValues: this.yFormulaValues,
      worksheet,
      defaultColCount: DEFAULT_COLS,
    });

    this.loadGridFromYjs();

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

    // Replace jspreadsheet's internal history with a Yjs-native one. The
    // built-in history is incompatible with our binding: (a) its replay path
    // sets `ignoreEvents=true`, so undos never propagate back into Yjs;
    // (b) it would record other users' edits we replay via setValueFromCoords
    // and let the local user "undo" them. yFormulaValues is excluded — it's
    // computed cache, not user content.
    this.worksheet.ignoreHistory = true;
    this.undoManager = new Y.UndoManager(
      [
        this.yData,
        this.yStyles,
        this.yColWidths,
        this.yRowHeights,
        this.yMerges,
        this.yMeta,
        this.yRowOrder,
        this.yColOrder,
      ],
      { trackedOrigins: new Set([this.localWriteOrigin]) },
    );
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
        if (rowMap.get(String(c))) { hasContent = true; break; }
      }
      if (hasContent) { lastNonEmpty = r; break; }
    }

    const keepRows = lastNonEmpty + 1;
    if (this.yData.length > keepRows) {
      this.yData.doc!.transact(() => {
        this.yData.delete(keepRows, this.yData.length - keepRows);
      });
    }
  }

  /** Public snapshot of the current row/col order arrays. */
  getRowOrder(): string[] { return this.yRowOrder.toArray(); }
  getColOrder(): string[] { return this.yColOrder.toArray(); }

  /** Lazily grow yData to include the given row index. */
  private ensureRows(upToIndex: number) {
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    while (this.yData.length <= upToIndex) {
      const rowMap = new Y.Map<string>();
      for (let c = 0; c < colCount; c++) rowMap.set(String(c), "");
      this.yData.push([rowMap]);
      this.rowIndexCache.set(rowMap, this.yData.length - 1);
    }
  }

  /**
   * Seed an empty (or near-empty) sheet with imported cell data. Writes
   * directly to Yjs in one transaction; existing observers push the values
   * into jspreadsheet and partyserver replicates to other clients.
   */
  seedFromImport(rows: unknown[][]) {
    if (rows.length === 0) return;

    const importColCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (importColCount === 0) return;

    const targetColCount = Math.max(importColCount, DEFAULT_COLS);

    this.yData.doc!.transact(() => {
      const currentColCount =
        (this.yMeta.get("colCount") as number | undefined) ?? DEFAULT_COLS;
      if (targetColCount > currentColCount) {
        this.yMeta.set("colCount", targetColCount);
        for (let r = 0; r < this.yData.length; r++) {
          const rowMap = this.yData.get(r);
          for (let c = currentColCount; c < targetColCount; c++) rowMap.set(String(c), "");
        }
      }

      while (this.yData.length < rows.length) {
        const rowMap = new Y.Map<string>();
        for (let c = 0; c < targetColCount; c++) rowMap.set(String(c), "");
        this.yData.push([rowMap]);
      }

      for (let r = 0; r < rows.length; r++) {
        const rowMap = this.yData.get(r);
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const cell = stringifyImportedCell(row[c]);
          if (cell === "") continue;
          rowMap.set(String(c), cell);
        }
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
        this.rowIndexCache.set(rowMap, r);
        const row: string[] = [];
        for (let c = 0; c < colCount; c++) row.push(rowMap.get(String(c)) ?? "");
        data.push(row);
      }

      // Grow the worksheet to match yMeta dimensions before setData.
      // jspreadsheet pre-allocates column/row configs at instantiation; if the
      // persisted sheet has more columns or rows, setData would index past
      // the end and crash inside createCell with "Cannot read properties of
      // undefined (reading 'style')".
      try {
        const currentCols = this.worksheet.options?.columns?.length ?? DEFAULT_COLS;
        if (colCount > currentCols) {
          this.worksheet.insertColumn(colCount - currentCols, currentCols - 1, false);
        }
      } catch { /* */ }
      try {
        const currentRows = this.worksheet.rows?.length ?? DEFAULT_ROWS;
        if (data.length > currentRows) {
          this.worksheet.insertRow(data.length - currentRows, currentRows - 1, false);
        }
      } catch { /* */ }

      this.worksheet.setData(data);
      this.formulaTracker.seedFromSnapshot(data);

      this.yColWidths.forEach((width: number, col: string) => {
        try { this.worksheet.setWidth(Number(col), width); } catch { /* */ }
      });
      this.yRowHeights.forEach((height: number, row: string) => {
        try { this.worksheet.setHeight(Number(row), height); } catch { /* */ }
      });
      this.yStyles.forEach((style: string, key: string) => {
        const [row, col] = key.split(",").map(Number);
        try { this.worksheet.setStyle(this.cellNameAt(row, col), style); } catch { /* */ }
      });
      this.yMerges.forEach((value: string, cellName: string) => {
        const [colspan, rowspan] = value.split(",").map(Number);
        try { this.worksheet.setMerge(cellName, colspan, rowspan); } catch { /* */ }
      });
    } finally {
      this.isApplyingRemote = false;
    }

    if (!this.formulaTracker.isEmpty) this.formulaTracker.scheduleRefresh();
    this.overlays.refreshReferencedCells();
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
    _instance: unknown,
    changes: Array<{ x: string; y: string; value: unknown }>,
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
        rowMap?.set(String(col), stringifyCellValue(c.value));
      }
    }, this.localWriteOrigin);

    for (const c of changes) {
      this.formulaTracker.noteCellChange(Number(c.y), Number(c.x), stringifyCellValue(c.value));
    }
    this.formulaTracker.scheduleRefresh();
  }

  /** v5: oninsertrow(instance, rows: { row: number; data: CellValue[] }[]) */
  oninsertrow(
    _instance: unknown,
    rows: Array<{ row: number; data: unknown[] }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!rows || rows.length === 0) return;
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    const sorted = [...rows].sort((a, b) => a.row - b.row);
    const insertAt = sorted[0].row;

    this.yData.doc!.transact(() => {
      for (let i = 0; i < sorted.length; i++) {
        const at = sorted[i].row + i;
        this.ensureRows(at > 0 ? at - 1 : 0);
        const rowMap = new Y.Map<string>();
        for (let c = 0; c < colCount; c++) rowMap.set(String(c), "");
        this.yData.insert(at, [rowMap]);
        if (at <= this.yRowOrder.length) {
          this.yRowOrder.insert(at, [makeStableId("r")]);
        }
      }
    }, this.localWriteOrigin);

    this.shiftFormulaRefs({ type: "insertRow", index: insertAt, count: sorted.length });
  }

  /** v5: ondeleterow(instance, removedRows: number[]) */
  ondeleterow(_instance: unknown, removedRows: number[]) {
    if (this.isApplyingRemote) return;
    if (!removedRows || removedRows.length === 0) return;
    const ascending = [...removedRows].sort((a, b) => a - b);
    const deleteAt = ascending[0];

    this.yData.doc!.transact(() => {
      const descending = [...removedRows].sort((a, b) => b - a);
      for (const rowIdx of descending) {
        if (rowIdx < this.yData.length) this.yData.delete(rowIdx, 1);
        if (rowIdx < this.yRowOrder.length) this.yRowOrder.delete(rowIdx, 1);
      }
    }, this.localWriteOrigin);

    this.shiftFormulaRefs({ type: "deleteRow", index: deleteAt, count: ascending.length });
  }

  /** v5: oninsertcolumn(instance, columns: { column: number; options: any; data?: any[] }[]) */
  oninsertcolumn(
    _instance: unknown,
    columns: Array<{ column: number; options: unknown; data?: unknown[] }>,
  ) {
    if (this.isApplyingRemote) return;
    if (!columns || columns.length === 0) return;
    const currentColCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    const numCols = columns.length;
    const insertAt = Math.min(...columns.map(c => c.column));

    this.yData.doc!.transact(() => {
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        for (let c = currentColCount - 1; c >= insertAt; c--) {
          const val = rowMap.get(String(c)) ?? "";
          rowMap.set(String(c + numCols), val);
        }
        for (let i = 0; i < numCols; i++) rowMap.set(String(insertAt + i), "");
      }
      this.yMeta.set("colCount", currentColCount + numCols);
      if (insertAt <= this.yColOrder.length) {
        const ids: string[] = [];
        for (let i = 0; i < numCols; i++) ids.push(makeStableId("c"));
        this.yColOrder.insert(insertAt, ids);
      }
    }, this.localWriteOrigin);

    this.shiftFormulaRefs({ type: "insertCol", index: insertAt, count: numCols });
  }

  /** v5: ondeletecolumn(instance, removedColumns: number[]) */
  ondeletecolumn(_instance: unknown, removedColumns: number[]) {
    if (this.isApplyingRemote) return;
    if (!removedColumns || removedColumns.length === 0) return;
    const currentColCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;
    const numCols = removedColumns.length;
    const deleteAt = Math.min(...removedColumns);

    this.yData.doc!.transact(() => {
      for (let r = 0; r < this.yData.length; r++) {
        const rowMap = this.yData.get(r);
        for (let c = deleteAt; c < currentColCount - numCols; c++) {
          const val = rowMap.get(String(c + numCols)) ?? "";
          rowMap.set(String(c), val);
        }
        for (let c = currentColCount - numCols; c < currentColCount; c++) {
          rowMap.delete(String(c));
        }
      }
      this.yMeta.set("colCount", currentColCount - numCols);
      if (deleteAt < this.yColOrder.length) {
        const removable = Math.min(numCols, this.yColOrder.length - deleteAt);
        if (removable > 0) this.yColOrder.delete(deleteAt, removable);
      }
    }, this.localWriteOrigin);

    this.shiftFormulaRefs({ type: "deleteCol", index: deleteAt, count: numCols });
  }

  /**
   * Rewrite A1 references inside formula text after a structural change.
   * Snapshots the post-shift grid, runs the pure planner, applies the
   * resulting rewrites to Yjs and the worksheet so display values recompute
   * on the next refresh tick.
   */
  private shiftFormulaRefs(op: ShiftOp) {
    const colCount = (this.yMeta.get("colCount") as number) ?? DEFAULT_COLS;

    const snapshot: string[][] = [];
    for (let r = 0; r < this.yData.length; r++) {
      const rowMap = this.yData.get(r);
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) row.push(rowMap.get(String(c)) ?? "");
      snapshot.push(row);
    }

    const rewrites = planFormulaShift(snapshot, op);
    if (rewrites.length === 0) return;

    this.yData.doc!.transact(() => {
      for (const { row, col, next } of rewrites) {
        this.yData.get(row).set(String(col), next);
      }
    }, this.localWriteOrigin);

    // Sync the worksheet so jspreadsheet evaluates the rewritten formulas.
    // Suppress the onafterchanges echo via isApplyingRemote.
    this.isApplyingRemote = true;
    try {
      for (const { row, col, next } of rewrites) {
        try { this.worksheet.setValueFromCoords(col, row, next); } catch { /* */ }
      }
    } finally {
      this.isApplyingRemote = false;
    }

    this.formulaTracker.rebuild();
    this.formulaTracker.scheduleRefresh();
  }

  /** v5: onchangestyle(instance, changes: Record<string, string>) */
  onchangestyle(_instance: unknown, changes: Record<string, string>) {
    if (this.isApplyingRemote) return;
    if (!changes) return;
    this.yData.doc!.transact(() => {
      for (const [cellName, style] of Object.entries(changes)) {
        const coords = parseCellNameInternal(cellName);
        if (!coords) continue;
        const styleKey = `${coords.row},${coords.col}`;
        if (style) this.yStyles.set(styleKey, style);
        else this.yStyles.delete(styleKey);
      }
    }, this.localWriteOrigin);
  }

  /** v5: onresizecolumn(instance, colIndex, newWidth, oldWidth) */
  onresizecolumn(
    _instance: unknown,
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
      }, this.localWriteOrigin);
    } else {
      // Wrap the single-set in a transaction so it's tagged with our origin
      // and tracked by Y.UndoManager.
      this.yData.doc!.transact(() => {
        this.yColWidths.set(String(colIndex), newWidth as number);
      }, this.localWriteOrigin);
    }
  }

  /** v5: onresizerow(instance, rowIndex, newHeight, oldHeight) */
  onresizerow(_instance: unknown, rowIndex: number, newHeight: number) {
    if (this.isApplyingRemote) return;
    this.yData.doc!.transact(() => {
      this.yRowHeights.set(String(rowIndex), newHeight);
    }, this.localWriteOrigin);
  }

  /** v5: onmerge(instance, merges: Record<string, [number, number]>) */
  onmerge(_instance: unknown, merges: Record<string, [number, number]>) {
    if (this.isApplyingRemote) return;
    if (!merges) return;
    this.yData.doc!.transact(() => {
      for (const [cellName, [colspan, rowspan]] of Object.entries(merges)) {
        if (colspan <= 1 && rowspan <= 1) this.yMerges.delete(cellName);
        else this.yMerges.set(cellName, `${colspan},${rowspan}`);
      }
    }, this.localWriteOrigin);
  }

  /** v5: onselection(instance, x1, y1, x2, y2, origin)
   *  Throttled via rAF to avoid flooding awareness during drag-select. */
  onselection(
    _instance: unknown,
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

  private handleDataChange(events: Y.YEvent<Y.AbstractType<unknown>>[], tx: Y.Transaction) {
    this.notifySubscribers();
    // Skip the "user just typed in the cell" echo: the value is already in
    // jspreadsheet. Apply for: remote peer edits, undo/redo replays.
    if (tx.local && tx.origin === this.localWriteOrigin) return;
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
    // Remote data changes may trigger formula recalculation in jspreadsheet.
    this.formulaTracker.scheduleRefresh();
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
              if (val) this.worksheet.setValueFromCoords(c, index + i, val);
            }
          } catch { /* */ }
        }
        index += rows.length;
      } else if (delta.delete) {
        try { this.worksheet.deleteRow(index, delta.delete); } catch { /* */ }
      }
    }
    this.rebuildRowIndexCache();
    this.formulaTracker.rebuild();
    this.overlays.refreshReferencedCells();
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
        this.formulaTracker.noteCellChange(rowIndex, col, value);
      }
    });
  }

  private handleStylesChange(event: Y.YMapEvent<string>) {
    if (event.transaction.local && event.transaction.origin === this.localWriteOrigin) return;
    this.isApplyingRemote = true;
    try {
      event.changes.keys.forEach((change, key) => {
        const [row, col] = key.split(",").map(Number);
        const cellName = this.cellNameAt(row, col);
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
    if (event.transaction.local && event.transaction.origin === this.localWriteOrigin) return;
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
    if (event.transaction.local && event.transaction.origin === this.localWriteOrigin) return;
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
    if (event.transaction.local && event.transaction.origin === this.localWriteOrigin) return;
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
  // Public API — overlays + cursors (delegated to subsystems)
  // ---------------------------------------------------------------------------

  /** Set the persistent reference highlights (Link2 toggle on the page header). */
  setReferencedCells(refs: { cellRef: string }[]) {
    this.overlays.setReferencedCells(refs);
  }

  /** Set the transient marching-ants highlights for refs in a formula being edited. */
  setFormulaEditHighlights(refs: string[]) {
    this.overlays.setFormulaEditHighlights(refs);
  }

  /** Clear the marching-ants highlights. Re-renders the persistent overlay. */
  clearFormulaEditHighlights(options?: { rerenderRefs?: boolean }) {
    this.overlays.clearFormulaEditHighlights(options);
  }

  /** Update the active remote client set (mirrors the facepile). Cursors for
   *  clients not in this set are removed. */
  setActiveClients(ids: Set<number>) {
    this.cursors?.setActiveClients(ids);
  }

  // ---------------------------------------------------------------------------
  // Public API — cell read/write (formula bar)
  // ---------------------------------------------------------------------------

  /** Read the raw stored value of a cell (formula text, not the computed value). */
  getRawCellValue(row: number, col: number): string {
    if (row < 0 || col < 0) return "";
    if (row >= this.yData.length) return "";
    const rowMap = this.yData.get(row);
    return rowMap?.get(String(col)) ?? "";
  }

  /** Write a raw value to a cell from outside jspreadsheet (e.g. formula bar).
   *  Mirrors the local-edit path used by `onafterchanges`, plus pushes the
   *  value into the visible grid (otherwise only remote peers would see it). */
  setRawCellValue(row: number, col: number, value: string) {
    if (row < 0 || col < 0) return;
    this.isApplyingRemote = true;
    try {
      this.yData.doc!.transact(() => {
        this.ensureRows(row);
        const rowMap = this.yData.get(row);
        rowMap?.set(String(col), value);
      }, this.localWriteOrigin);
      try { this.worksheet.setValueFromCoords(col, row, value); } catch { /* */ }
    } finally {
      this.isApplyingRemote = false;
    }
    this.formulaTracker.noteCellChange(row, col, value);
    this.formulaTracker.scheduleRefresh();
  }

  /** Convert (row, col) to "A1"-style cell name. */
  cellNameAt(row: number, col: number): string {
    let name = "";
    let c = col;
    do {
      name = String.fromCharCode(65 + (c % 26)) + name;
      c = Math.floor(c / 26) - 1;
    } while (c >= 0);
    return name + (row + 1);
  }

  /** Yjs-native undo. Reverts the most recent local-write transaction. */
  undo() { this.undoManager.undo(); }

  /** Yjs-native redo. Mirror of `undo`. */
  redo() { this.undoManager.redo(); }

  /** Underlying jspreadsheet worksheet instance. Exposed for export utilities
   *  (CSV/XLSX) that need to call `getData()` / `download()` directly. */
  getWorksheet(): any { return this.worksheet; }

  /** Subscribe to data changes (local or remote). Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  private notifySubscribers() {
    for (const listener of this.subscribers) {
      try { listener(); } catch { /* */ }
    }
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

    if (this.selectionRafId !== null) cancelAnimationFrame(this.selectionRafId);

    this.overlays.destroy();
    this.cursors?.destroy();
    this.formulaTracker.destroy();

    this.subscribers.clear();
    this.undoManager.destroy();
  }
}

/** Local helper for `onchangestyle` — parses jspreadsheet's "A1"-style cell
 *  names back to coordinates. Doesn't need to be public. */
function parseCellNameInternal(cellName: string): { col: number; row: number } | null {
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
