/**
 * Pure helpers for the **frozen** spreadsheet ranges a chat message carries.
 *
 * A chat range is a snapshot, not an embed: the sender picks cells, the numbers
 * are read once and the message keeps them forever (see
 * `Chat/SpreadsheetRangeDialog.tsx`). That makes the picked rectangle the only
 * description of the data the channel will ever get, so it is worth tidying at
 * pick time rather than rendering whatever the drag happened to cover.
 *
 * Everything here is text-in / text-out so the rules can be tested without a
 * Y.Doc, an editor or a DOM.
 */

import { parseRange, toCellName } from "@ripple/shared/cellRef";

/** A trimmed snapshot: the values that survived, and the range they now cover. */
export interface TrimmedRange {
  values: string[][];
  /** A1 for the surviving rectangle. Single cell when it collapsed to one. */
  cellRef: string;
}

/**
 * Drops the fully-blank rows and columns around the edge of a picked range.
 *
 * Selecting cells with a mouse overshoots — the range in the screenshot that
 * started this was three blank columns wide around two words. Blank *interior*
 * rows and columns are kept: a gap between two groups of numbers is part of the
 * shape of the data, while a blank rim is just where the drag stopped.
 *
 * The A1 label is recomputed from what survived, so the chip above the grid
 * keeps naming exactly the cells shown. Returns `null` when the whole range was
 * empty — there is no snapshot to make of nothing, and the caller falls back to
 * the bare reference chip.
 */
export function trimSnapshotRange(
  values: string[][],
  cellRef: string,
): TrimmedRange | null {
  const range = parseRange(cellRef);
  if (!range) return null;

  const rowCount = range.endRow - range.startRow + 1;
  const colCount = range.endCol - range.startCol + 1;
  if (rowCount <= 0 || colCount <= 0) return null;

  const at = (r: number, c: number) => values[r]?.[c] ?? "";
  const filled = (r: number, c: number) => at(r, c).trim() !== "";

  let top = 0;
  while (top < rowCount && !anyInRow(top, colCount, filled)) top++;
  // Every row was blank, so every column is too — nothing to show.
  if (top === rowCount) return null;

  let bottom = rowCount - 1;
  while (bottom > top && !anyInRow(bottom, colCount, filled)) bottom--;

  let left = 0;
  while (left < colCount && !anyInColumn(left, top, bottom, filled)) left++;

  let right = colCount - 1;
  while (right > left && !anyInColumn(right, top, bottom, filled)) right--;

  const trimmed: string[][] = [];
  for (let r = top; r <= bottom; r++) {
    const row: string[] = [];
    for (let c = left; c <= right; c++) row.push(at(r, c));
    trimmed.push(row);
  }

  const start = toCellName(range.startCol + left, range.startRow + top);
  const end = toCellName(range.startCol + right, range.startRow + bottom);

  return { values: trimmed, cellRef: start === end ? start : `${start}:${end}` };
}

function anyInRow(
  r: number,
  colCount: number,
  filled: (r: number, c: number) => boolean,
): boolean {
  for (let c = 0; c < colCount; c++) if (filled(r, c)) return true;
  return false;
}

function anyInColumn(
  c: number,
  top: number,
  bottom: number,
  filled: (r: number, c: number) => boolean,
): boolean {
  for (let r = top; r <= bottom; r++) if (filled(r, c)) return true;
  return false;
}

/**
 * True when a cell reads as a quantity, so the renderer can right-align it and
 * put it on tabular figures — the one typographic thing that makes a column of
 * numbers scannable.
 *
 * Deliberately loose: the value is already-formatted display text out of the
 * sheet, so currency marks, thousands separators, a trailing percent and
 * accounting parentheses all still count as a number.
 */
export function isNumericCell(text: string): boolean {
  const stripped = text
    .trim()
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[\s $€£¥%,]/g, "");
  return stripped !== "" && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(stripped);
}

/**
 * True when the first row reads as column labels rather than data: it says
 * something, it says nothing numeric, and there are numbers underneath it.
 *
 * A guess, but a cheap and self-correcting one — the worst case is a bolder
 * first row on a grid of plain text, which is what a spreadsheet's own first
 * row usually is anyway.
 */
export function hasHeaderRow(values: string[][]): boolean {
  if (values.length < 2) return false;
  const [head, ...body] = values;
  if (!head.some((cell) => cell.trim() !== "")) return false;
  if (head.some(isNumericCell)) return false;
  return body.some((row) => row.some(isNumericCell));
}
