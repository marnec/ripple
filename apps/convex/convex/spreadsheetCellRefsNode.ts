"use node";

import { ConvexError, v } from "convex/values";
import * as Y from "yjs";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { normalizeCellRef, parseCellName, parseRange } from "@ripple/shared/cellRef";
import {
  a1ToStable,
  parseStableRef,
  resolveStableRef,
  serializeStableRef,
} from "@ripple/shared/stableRef";

/**
 * Populate a cell ref cache entry from the Yjs snapshot stored in Convex.
 * Scheduled by ensureCellRef after creating a placeholder.
 *
 * Resolves stableRef → live A1 against the snapshot's `rowOrder` / `colOrder`
 * and extracts cell values from that position. Marks orphan if the IDs
 * disappeared.
 */
export const populateFromSnapshot = internalAction({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    stableRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { spreadsheetId, stableRef: stableRefIn }) => {
    const spreadsheet = await ctx.runQuery(
      internal.spreadsheetCellRefs.getSpreadsheetInternal,
      { id: spreadsheetId },
    );
    if (!spreadsheet?.yjsSnapshotId) return null;

    const url = await ctx.storage.getUrl(spreadsheet.yjsSnapshotId);
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();

    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(arrayBuffer));
    const yData = yDoc.getArray<Y.Map<string>>("data");
    const yFormulaValues = yDoc.getMap<string>("formulaValues");
    const rowOrder = yDoc.getArray<string>("rowOrder").toArray();
    const colOrder = yDoc.getArray<string>("colOrder").toArray();

    const stableRef = parseStableRef(stableRefIn);
    if (!stableRef) {
      yDoc.destroy();
      return null;
    }

    const resolved = resolveStableRef(stableRef, rowOrder, colOrder);
    const orphan = !resolved.ok;
    const liveA1 = resolved.ok ? resolved.a1 : null;
    const values =
      orphan || !liveA1
        ? [[""]]
        : extractCellValues(yData, liveA1, yFormulaValues) ?? [[""]];

    yDoc.destroy();

    await ctx.runMutation(internal.spreadsheetCellRefs.upsertCellValues, {
      spreadsheetId,
      updates: [
        {
          stableRef: stableRefIn,
          liveCellRef: liveA1 ?? undefined,
          values: JSON.stringify(values),
          orphan,
        },
      ],
    });

    return null;
  },
});

/**
 * Compute a `stableRef` for an A1 string against the spreadsheet's current
 * snapshot. Used at block-creation time to capture the stable identity of a
 * cell before the cache row is inserted.
 *
 * Throws when the snapshot lacks order arrays — that's a programming error
 * post-Phase-B and indicates a sheet that pre-dates stable IDs (which we no
 * longer support).
 */
export const prepareStableRef = action({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    cellRef: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, { spreadsheetId, cellRef }) => {
    const allowed = await ctx.runQuery(api.spreadsheets.get, { id: spreadsheetId });
    if (!allowed) throw new ConvexError("Spreadsheet not found or access denied");

    const spreadsheet = await ctx.runQuery(
      internal.spreadsheetCellRefs.getSpreadsheetInternal,
      { id: spreadsheetId },
    );
    if (!spreadsheet?.yjsSnapshotId) {
      throw new ConvexError("Spreadsheet has no saved state yet");
    }

    const url = await ctx.storage.getUrl(spreadsheet.yjsSnapshotId);
    if (!url) throw new ConvexError("Could not access spreadsheet snapshot");

    const response = await fetch(url);
    if (!response.ok) throw new ConvexError("Failed to fetch spreadsheet snapshot");
    const arrayBuffer = await response.arrayBuffer();

    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(arrayBuffer));
    const rowOrder = yDoc.getArray<string>("rowOrder").toArray();
    const colOrder = yDoc.getArray<string>("colOrder").toArray();
    yDoc.destroy();

    if (rowOrder.length === 0 || colOrder.length === 0) {
      throw new ConvexError(
        "Spreadsheet snapshot is missing stable order arrays. Pre-Phase-B sheets are not supported.",
      );
    }
    const stable = a1ToStable(normalizeCellRef(cellRef), rowOrder, colOrder);
    if (!stable) {
      throw new ConvexError("Cell reference is out of bounds for this spreadsheet");
    }
    return serializeStableRef(stable);
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
