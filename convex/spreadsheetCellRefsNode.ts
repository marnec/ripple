"use node";

import { v } from "convex/values";
import * as Y from "yjs";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeCellRef, parseCellName, parseRange } from "@shared/cellRef";

/**
 * Populate a cell ref cache entry from the Yjs snapshot stored in Convex.
 * Scheduled by ensureCellRef after creating a placeholder — reads actual values
 * from the last saved snapshot so the user sees real data immediately.
 */
export const populateFromSnapshot = internalAction({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, cellRef }) => {
    // Get the spreadsheet to find its snapshot
    const spreadsheet = await ctx.runQuery(
      internal.spreadsheetCellRefs.getSpreadsheetInternal,
      { id: spreadsheetId },
    );
    if (!spreadsheet?.yjsSnapshotId) return null;

    // Get the download URL for the snapshot blob
    const url = await ctx.storage.getUrl(spreadsheet.yjsSnapshotId);
    if (!url) return null;

    // Fetch the binary Yjs state
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();

    // Parse with Yjs
    const yDoc = new Y.Doc();
    Y.applyUpdateV2(yDoc, new Uint8Array(arrayBuffer));
    const yData = yDoc.getArray<Y.Map<string>>("data");
    const yFormulaValues = yDoc.getMap<string>("formulaValues");

    // Extract cell values (resolves formulas to computed display values)
    const normalized = normalizeCellRef(cellRef);
    const values = extractCellValues(yData, normalized, yFormulaValues);
    yDoc.destroy();

    if (!values) return null;

    // Update the cache entry
    await ctx.runMutation(internal.spreadsheetCellRefs.upsertCellValues, {
      spreadsheetId,
      updates: [{ cellRef: normalized, values: JSON.stringify(values) }],
    });

    return null;
  },
});

/**
 * If the raw cell value is a formula (starts with "="), return the computed
 * display value from formulaValues. Falls back to raw value if not available.
 */
function resolveDisplayValue(
  rawValue: string,
  row: number,
  col: number,
  yFormulaValues?: Y.Map<string>,
): string {
  if (rawValue.startsWith("=") && yFormulaValues) {
    const computed = yFormulaValues.get(`${row},${col}`);
    if (computed !== undefined) return computed;
  }
  return rawValue;
}

function extractCellValues(
  yData: Y.Array<Y.Map<string>>,
  cellRef: string,
  yFormulaValues?: Y.Map<string>,
): string[][] | null {
  if (cellRef.includes(":")) {
    const range = parseRange(cellRef);
    if (!range) return null;
    const result: string[][] = [];
    for (let r = range.startRow; r <= range.endRow && r < yData.length; r++) {
      const row: string[] = [];
      const rowMap = yData.get(r);
      for (let c = range.startCol; c <= range.endCol; c++) {
        const raw = rowMap?.get(String(c)) ?? "";
        row.push(resolveDisplayValue(raw, r, c, yFormulaValues));
      }
      result.push(row);
    }
    return result;
  } else {
    const cell = parseCellName(cellRef);
    if (!cell) return null;
    if (cell.row >= yData.length) return [[""]];
    const rowMap = yData.get(cell.row);
    const raw = rowMap?.get(String(cell.col)) ?? "";
    return [[resolveDisplayValue(raw, cell.row, cell.col, yFormulaValues)]];
  }
}
