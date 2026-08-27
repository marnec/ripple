import { parseCellName, parseRange } from "./cellRef";

/**
 * Reads one cell's raw (authored) value. Rows and columns are zero-based.
 * Returns "" for a cell that was never written.
 */
export type ReadCell = (row: number, col: number) => string;

/**
 * Reads one cell's computed value, for cells whose raw value is a formula.
 * Returns undefined when nothing has been computed for that cell yet.
 */
export type ReadFormulaValue = (row: number, col: number) => string | undefined;

export interface CellSource {
  read: ReadCell;
  /** Number of rows that exist; the rect is clipped to it. */
  rowCount: number;
  formulaValue?: ReadFormulaValue;
}

/**
 * A cell shows its computed value when it holds a formula, and its raw value
 * otherwise. Falls back to the raw text when nothing has been computed — a
 * freshly typed formula reads as `=SUM(A1:A9)` for the moment before the
 * evaluator catches up, which is better than reading as blank.
 */
function displayValue(
  raw: string,
  row: number,
  col: number,
  formulaValue?: ReadFormulaValue,
): string {
  if (raw.startsWith("=") && formulaValue) {
    const computed = formulaValue(row, col);
    if (computed !== undefined) return computed;
  }
  return raw;
}

/**
 * The display values of an A1 cell or range, as a row-major grid.
 *
 * Deliberately knows nothing about Yjs: the three callers each hold the grid in
 * a different shape — Convex reads a snapshot's `Y.Array`, PartyKit reads the
 * live room's, and the chat composer reads a hydrated client replica — while
 * the rule for *which* rect and *which* value per cell is one rule. Taking
 * accessors instead of containers keeps that rule testable with plain values
 * and keeps `@ripple/shared` free of a yjs dependency.
 *
 * Returns null for an unparseable ref. A rect that runs past the last row is
 * clipped rather than padded, matching what the grid itself would show.
 */
export function extractCellValues(
  cellRef: string,
  { read, rowCount, formulaValue }: CellSource,
): string[][] | null {
  if (cellRef.includes(":")) {
    const range = parseRange(cellRef);
    if (!range) return null;
    const result: string[][] = [];
    for (let r = range.startRow; r <= range.endRow && r < rowCount; r++) {
      const row: string[] = [];
      for (let c = range.startCol; c <= range.endCol; c++) {
        row.push(displayValue(read(r, c), r, c, formulaValue));
      }
      result.push(row);
    }
    return result;
  }

  const cell = parseCellName(cellRef);
  if (!cell) return null;
  if (cell.row >= rowCount) return [[""]];
  return [[displayValue(read(cell.row, cell.col), cell.row, cell.col, formulaValue)]];
}
