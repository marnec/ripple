/**
 * Cell reference parsing and validation utilities.
 * Shared across frontend, Convex backend, and PartyKit server.
 */

const MAX_CELLS = 100;

/** Parse "A1" into { col: 0, row: 0 } (0-indexed). Returns null if invalid. */
export function parseCellName(cellName: string): { col: number; row: number } | null {
  const match = cellName.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (let i = 0; i < match[1].length; i++) {
    col = col * 26 + (match[1].charCodeAt(i) - 64);
  }
  col -= 1;
  const row = parseInt(match[2], 10) - 1;
  if (row < 0) return null;
  return { col, row };
}

/** Convert 0-indexed (col, row) to "A1" format. */
export function toCellName(col: number, row: number): string {
  let name = "";
  let c = col;
  do {
    name = String.fromCharCode(65 + (c % 26)) + name;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return name + (row + 1);
}

/** Parse "A1:C3" into start/end coordinates (0-indexed). Returns null if invalid. */
export function parseRange(
  rangeStr: string,
): { startCol: number; startRow: number; endCol: number; endRow: number } | null {
  const parts = rangeStr.toUpperCase().split(":");
  if (parts.length !== 2) return null;
  const start = parseCellName(parts[0]);
  const end = parseCellName(parts[1]);
  if (!start || !end) return null;
  return {
    startCol: Math.min(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endCol: Math.max(start.col, end.col),
    endRow: Math.max(start.row, end.row),
  };
}

/** Normalize a cell reference to uppercase. */
export function normalizeCellRef(ref: string): string {
  return ref.toUpperCase().trim();
}

/** Check if a string is a single cell (not a range). */
export function isSingleCell(ref: string): boolean {
  return !ref.includes(":");
}

/** Count the number of cells in a reference. */
export function countCells(ref: string): number {
  const normalized = normalizeCellRef(ref);
  if (isSingleCell(normalized)) return 1;
  const range = parseRange(normalized);
  if (!range) return 0;
  return (range.endCol - range.startCol + 1) * (range.endRow - range.startRow + 1);
}

/** Validate a cell reference string (single cell or range). */
export function isValidCellRef(ref: string): boolean {
  const normalized = normalizeCellRef(ref);
  if (isSingleCell(normalized)) {
    return parseCellName(normalized) !== null;
  }
  return parseRange(normalized) !== null;
}

/** Check if a range exceeds the maximum allowed cells. */
export function exceedsMaxCells(ref: string, maxCells: number = MAX_CELLS): boolean {
  return countCells(ref) > maxCells;
}
