import * as Y from "yjs";
import { gridOrders, gridSource } from "@ripple/shared/spreadsheetDoc";

/**
 * Render a stored spreadsheet snapshot as a markdown table of what the cells
 * *show*, for the model to read: a formula cell contributes its computed
 * value, never the formula. Rows and columns come out in visual order, and a
 * grid past `maxRows` is cut with a note saying how many rows were left out.
 *
 * Reads the room's four shared types through `@ripple/shared/spreadsheetDoc`,
 * the one place their names are spelled, so a renamed type breaks here at
 * compile time rather than reading back a grid of blanks.
 */

export interface SpreadsheetTextOptions {
  /** Rows beyond this are summarised as a count. */
  maxRows?: number;
}

/** A, B, …, Z, AA, AB, … for a zero-based column index. */
function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function spreadsheetSnapshotToText(
  snapshot: Uint8Array,
  options: SpreadsheetTextOptions = {},
): string {
  const maxRows = options.maxRows ?? 200;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  try {
    const source = gridSource(doc);
    const { colOrder } = gridOrders(doc);
    const data = doc.getArray<Y.Map<string>>("data");
    if (source.rowCount === 0) return "";

    // The grid is as wide as its column order says, or as wide as any row
    // reaches when a sheet predates the order arrays.
    let width = colOrder.length;
    for (const row of data.toArray()) {
      for (const key of row.keys()) width = Math.max(width, Number(key) + 1);
    }
    if (width === 0) return "";

    const shown = Math.min(source.rowCount, maxRows);
    const lines = [
      `| ${Array.from({ length: width }, (_, c) => columnLabel(c)).join(" | ")} |`,
      `|${" --- |".repeat(width)}`,
    ];
    for (let r = 0; r < shown; r++) {
      const cells: string[] = [];
      for (let c = 0; c < width; c++) {
        const raw = source.read(r, c);
        const computed = raw.startsWith("=") ? source.formulaValue?.(r, c) : undefined;
        cells.push(cell(computed ?? raw));
      }
      lines.push(`| ${cells.join(" | ")} |`);
    }
    const omitted = source.rowCount - shown;
    if (omitted > 0) lines.push("", `[${omitted} more rows not shown]`);
    return lines.join("\n");
  } finally {
    doc.destroy();
  }
}
