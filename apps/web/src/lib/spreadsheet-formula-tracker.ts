import type * as Y from "yjs";

/** Safely coerce a jspreadsheet computed value into a string. Avoids the
 *  default `[object Object]` fallback when the cell evaluator yields something
 *  unexpected — empty string is a better signal for "no display value". */
function stringifyDisplayValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

interface FormulaTrackerOptions {
  yData: Y.Array<Y.Map<string>>;
  yMeta: Y.Map<unknown>;
  yFormulaValues: Y.Map<string>;
  worksheet: unknown;
  /** Default column count to scan if `meta.colCount` is missing. */
  defaultColCount: number;
}

/**
 * Tracks which cells contain formulas (`=…` prefix) and keeps the Yjs
 * `yFormulaValues` map in sync with the computed display values jspreadsheet
 * evaluates. Server-side extractors (PartyKit + Convex) read this cache so
 * downstream consumers see results, not raw formulas.
 *
 * The two scheduling primitives:
 * - `noteCellChange(row, col, value)` — incremental update on a single edit
 * - `rebuild()` — full scan after structural changes (insert/delete row/col)
 * - `scheduleRefresh()` — debounce a computed-value sync; runs after the
 *   current Yjs transaction settles and jspreadsheet finishes evaluation.
 */
export class SpreadsheetFormulaTracker {
  private formulaCells = new Set<string>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: FormulaTrackerOptions) {}

  /** Build the initial set from a fully-loaded snapshot. */
  seedFromSnapshot(rows: ReadonlyArray<ReadonlyArray<string>>) {
    this.formulaCells.clear();
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c].startsWith("=")) this.formulaCells.add(`${r},${c}`);
      }
    }
  }

  /** Update tracking for one cell write. */
  noteCellChange(row: number, col: number, value: string) {
    const key = `${row},${col}`;
    if (typeof value === "string" && value.startsWith("=")) {
      this.formulaCells.add(key);
    } else {
      this.formulaCells.delete(key);
    }
  }

  /** Full scan to rebuild after structural changes. */
  rebuild() {
    const { yData, yMeta, defaultColCount } = this.opts;
    this.formulaCells.clear();
    const colCount = (yMeta.get("colCount") as number | undefined) ?? defaultColCount;
    for (let r = 0; r < yData.length; r++) {
      const rowMap = yData.get(r);
      for (let c = 0; c < colCount; c++) {
        const val = rowMap.get(String(c)) ?? "";
        if (val.startsWith("=")) this.formulaCells.add(`${r},${c}`);
      }
    }
  }

  /**
   * Schedule a deferred refresh. setTimeout(0) so it runs after jspreadsheet
   * finishes evaluating formulas and after the current Yjs transaction commits.
   */
  scheduleRefresh() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshDisplayValues();
    }, 0);
  }

  /** True if the tracker currently knows about any formula cells. */
  get isEmpty(): boolean {
    return this.formulaCells.size === 0;
  }

  private refreshDisplayValues() {
    const { yData, yFormulaValues, worksheet } = this.opts;
    const ws = worksheet as { getValueFromCoords?: (x: number, y: number, processed: boolean) => unknown } | null;
    if (!ws?.getValueFromCoords) return;

    const updates: Array<[string, string]> = [];
    const removals: string[] = [];

    for (const key of this.formulaCells) {
      const [rowStr, colStr] = key.split(",");
      const row = Number(rowStr);
      const col = Number(colStr);

      let displayValue: string;
      try {
        const val = ws.getValueFromCoords(col, row, true);
        displayValue = stringifyDisplayValue(val);
      } catch {
        continue;
      }

      const current = yFormulaValues.get(key);
      if (current !== displayValue) updates.push([key, displayValue]);
    }

    yFormulaValues.forEach((_value: string, key: string) => {
      if (!this.formulaCells.has(key)) removals.push(key);
    });

    if (updates.length === 0 && removals.length === 0) return;

    yData.doc!.transact(() => {
      for (const [key, value] of updates) yFormulaValues.set(key, value);
      for (const key of removals) yFormulaValues.delete(key);
    });
  }

  destroy() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.formulaCells.clear();
  }
}
