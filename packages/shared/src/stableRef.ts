/**
 * Stable cell references — track a logical cell across row/column structural
 * changes in a spreadsheet.
 *
 * A spreadsheet keeps two parallel order arrays of stable IDs (one per row,
 * one per column). When a row is inserted, a new ID is appended to `rowOrder`
 * at the insertion index; existing IDs never change. A reference to a cell
 * stores `(rowId, colId)` instead of `(rowIndex, colIndex)`, so it tracks the
 * same logical cell regardless of how many rows/cols are inserted or deleted
 * before it. If the row or column ID disappears from the order array, the
 * reference is orphaned.
 *
 * Shared across frontend, Convex backend, and PartyKit server.
 */

import { parseCellName, parseRange, toCellName } from "./cellRef";

export interface StableCellRef {
  rowId: string;
  colId: string;
}

export interface StableRangeRef {
  startRowId: string;
  startColId: string;
  endRowId: string;
  endColId: string;
}

export type StableRef = StableCellRef | StableRangeRef;

export function isStableRange(ref: StableRef): ref is StableRangeRef {
  return "startRowId" in ref;
}

/** JSON-encode for storage in Yjs / Convex / BlockNote props. */
export function serializeStableRef(ref: StableRef): string {
  return JSON.stringify(ref);
}

/** Parse a JSON-encoded StableRef. Returns null on malformed input. */
export function parseStableRef(json: string): StableRef | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.rowId === "string" && typeof obj.colId === "string") {
      return { rowId: obj.rowId, colId: obj.colId };
    }
    if (
      typeof obj.startRowId === "string" &&
      typeof obj.startColId === "string" &&
      typeof obj.endRowId === "string" &&
      typeof obj.endColId === "string"
    ) {
      return {
        startRowId: obj.startRowId,
        startColId: obj.startColId,
        endRowId: obj.endRowId,
        endColId: obj.endColId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export type OrphanReason = "startRow" | "endRow" | "startCol" | "endCol";

export type ResolveResult =
  | { ok: true; a1: string; row: number; col: number; endRow?: number; endCol?: number }
  | { ok: false; missing: OrphanReason[] };

/**
 * Resolve a StableRef against the current `rowOrder` and `colOrder` arrays.
 * Returns the live A1 string and indices, or an orphan result listing which
 * endpoints are missing.
 */
export function resolveStableRef(
  ref: StableRef,
  rowOrder: readonly string[],
  colOrder: readonly string[],
): ResolveResult {
  if (isStableRange(ref)) {
    const startRow = rowOrder.indexOf(ref.startRowId);
    const endRow = rowOrder.indexOf(ref.endRowId);
    const startCol = colOrder.indexOf(ref.startColId);
    const endCol = colOrder.indexOf(ref.endColId);
    const missing: OrphanReason[] = [];
    if (startRow === -1) missing.push("startRow");
    if (endRow === -1) missing.push("endRow");
    if (startCol === -1) missing.push("startCol");
    if (endCol === -1) missing.push("endCol");
    if (missing.length > 0) return { ok: false, missing };
    const a1 = `${toCellName(startCol, startRow)}:${toCellName(endCol, endRow)}`;
    return { ok: true, a1, row: startRow, col: startCol, endRow, endCol };
  }
  const row = rowOrder.indexOf(ref.rowId);
  const col = colOrder.indexOf(ref.colId);
  const missing: OrphanReason[] = [];
  if (row === -1) missing.push("startRow");
  if (col === -1) missing.push("startCol");
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, a1: toCellName(col, row), row, col };
}

/**
 * Convert an A1 string (or range) to a StableRef using the spreadsheet's
 * current `rowOrder` and `colOrder`. Returns null when the A1 indices fall
 * outside the order array bounds.
 */
export function a1ToStable(
  a1: string,
  rowOrder: readonly string[],
  colOrder: readonly string[],
): StableRef | null {
  const normalized = a1.toUpperCase().trim();
  if (normalized.includes(":")) {
    const range = parseRange(normalized);
    if (!range) return null;
    if (
      range.startRow >= rowOrder.length ||
      range.endRow >= rowOrder.length ||
      range.startCol >= colOrder.length ||
      range.endCol >= colOrder.length
    ) {
      return null;
    }
    return {
      startRowId: rowOrder[range.startRow],
      startColId: colOrder[range.startCol],
      endRowId: rowOrder[range.endRow],
      endColId: colOrder[range.endCol],
    };
  }
  const cell = parseCellName(normalized);
  if (!cell) return null;
  if (cell.row >= rowOrder.length || cell.col >= colOrder.length) return null;
  return { rowId: rowOrder[cell.row], colId: colOrder[cell.col] };
}
