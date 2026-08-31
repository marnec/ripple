import { isValidCellRef, toCellName } from "@ripple/shared/cellRef";

export interface FormulaRefMatch {
  /** The matched cell reference, normalized (uppercase, no `$`). */
  ref: string;
  /** Start index in the source formula string. */
  start: number;
  /** End index (exclusive) in the source formula string. */
  end: number;
}

// Matches A1 / $A$1 / A1:B5 / $A$1:$B$5. Negative lookbehind/ahead skip
// identifiers that look ref-like but aren't (function names like LOG10(),
// names embedded in larger words). The lookahead must also forbid word
// characters — otherwise the engine backtracks `\d+` to satisfy `(?!\()`
// and matches `LOG1` inside `LOG10(`.
const REF_PATTERN = /(?<![A-Z0-9_$])(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)(?![A-Z0-9_$(])/gi;

/**
 * Extract A1-style cell references from a formula string with their text
 * positions. Filters out syntactically valid but unparseable refs. Returns
 * empty if the input doesn't look like a formula.
 */
export function extractCellRefs(formula: string): FormulaRefMatch[] {
  if (!formula.startsWith("=")) return [];

  const refs: FormulaRefMatch[] = [];
  REF_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_PATTERN.exec(formula)) !== null) {
    const raw = m[1];
    const ref = raw.replace(/\$/g, "").toUpperCase();
    if (!isValidCellRef(ref)) continue;
    refs.push({ ref, start: m.index, end: m.index + raw.length });
  }
  return refs;
}

/**
 * Determine the substring range that should be replaced when the user picks
 * a cell with the mouse during formula editing. Returns null when the cursor
 * is not at a position where inserting a cell reference would be valid
 * (e.g. inside a string literal — not detected here — or before `=`).
 *
 * Behavior:
 * - If a cell-ref-like token straddles the cursor, return its span (the new
 *   ref replaces it).
 * - Else, if the character immediately before the cursor is a ref-boundary
 *   (`=`, `(`, `,`, operators, space, `:`), return a zero-width span at the
 *   cursor (the ref is inserted).
 * - Else, return null (e.g. cursor is mid-word inside a string).
 */
export function getRefInsertContext(
  value: string,
  cursor: number,
): { start: number; end: number } | null {
  if (!value.startsWith("=")) return null;

  const before = value.substring(0, cursor);
  const after = value.substring(cursor);

  // Trailing token before cursor — letters maybe followed by digits, or just
  // letters (partial column ref / partial function name we'll overwrite).
  const beforeMatch = before.match(/(\$?[A-Z]+\$?\d*)$/i);
  const start = beforeMatch ? cursor - beforeMatch[0].length : cursor;

  // Leading token after cursor — completes a row number or full ref.
  const afterMatch = after.match(/^(\$?\d+|\$?[A-Z]+\$?\d*)/i);
  const end = afterMatch ? cursor + afterMatch[0].length : cursor;

  // Boundary check: char before `start` must be a ref-acceptable boundary.
  if (start > 0) {
    const boundary = value[start - 1];
    if (!"=( ,+-*/^&<>:".includes(boundary)) return null;
  }

  return { start, end };
}

/** A grid selection box, top-left (`row`/`col`) to bottom-right inclusive. */
export interface GridSelection {
  row: number;
  col: number;
  endRow: number;
  endCol: number;
}

/** True when the selection box covers exactly one cell. */
export function isSingleCellSelection(sel: GridSelection): boolean {
  return sel.row === sel.endRow && sel.col === sel.endCol;
}

/** True when two selection boxes cover the same cells. */
export function sameSelection(a: GridSelection, b: GridSelection): boolean {
  return (
    a.row === b.row && a.col === b.col && a.endRow === b.endRow && a.endCol === b.endCol
  );
}

/** Normalize an anchor/head cell pair (a drag) into a top-left→bottom-right box. */
export function selectionFromDrag(
  anchor: { row: number; col: number },
  head: { row: number; col: number },
): GridSelection {
  return {
    row: Math.min(anchor.row, head.row),
    col: Math.min(anchor.col, head.col),
    endRow: Math.max(anchor.row, head.row),
    endCol: Math.max(anchor.col, head.col),
  };
}

/** Format a selection box as an A1-style reference — `A1` for a single cell,
 *  `A1:C3` for a range. */
export function formatSelectionRef(sel: GridSelection): string {
  const start = toCellName(sel.col, sel.row);
  if (isSingleCellSelection(sel)) return start;
  return `${start}:${toCellName(sel.endCol, sel.endRow)}`;
}

/**
 * Splice a picked cell reference into formula text.
 *
 * `span` is the range a previous pick wrote — pass it to keep a drag replacing
 * the ref it is growing instead of appending a new one, and pass null to start
 * a fresh insertion at the cursor. The returned `span` feeds the next call.
 */
export function applyRefPick(
  text: string,
  cursor: number,
  ref: string,
  span: { start: number; end: number } | null,
): { text: string; cursor: number; span: { start: number; end: number } } {
  const target =
    span ?? getRefInsertContext(text, cursor) ?? { start: cursor, end: cursor };
  const next = text.substring(0, target.start) + ref + text.substring(target.end);
  const nextCursor = target.start + ref.length;
  return {
    text: next,
    cursor: nextCursor,
    span: { start: target.start, end: nextCursor },
  };
}
