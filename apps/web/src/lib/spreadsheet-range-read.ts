import type * as Y from "yjs";
import { extractCellValues, type CellSource } from "@ripple/shared/cellValues";

/** Grid accessors for a spreadsheet room's Yjs shape. */
function cellSource(
  yData: Y.Array<Y.Map<string>>,
  yFormulaValues?: Y.Map<string>,
): CellSource {
  return {
    rowCount: yData.length,
    read: (row, col) => yData.get(row)?.get(String(col)) ?? "",
    formulaValue: (row, col) => yFormulaValues?.get(`${row},${col}`),
  };
}

/**
 * Read an A1 cell or range straight out of a spreadsheet room's replica.
 *
 * The caller must have established that the replica is **hydrated** — an empty
 * Y.Doc and one that simply hasn't been told anything yet are indistinguishable,
 * so reading an unhydrated replica yields a grid of blanks with no error. That
 * is why every caller here gates on `isHydrated` rather than on `yDoc` existing.
 *
 * Reading the live replica rather than the stored snapshot is deliberate: the
 * range picker shows the sender the live grid, so freezing anything else could
 * hand them numbers they never saw.
 */
export function readRangeValues(yDoc: Y.Doc, cellRef: string): string[][] | null {
  return extractCellValues(
    cellRef,
    cellSource(yDoc.getArray<Y.Map<string>>("data"), yDoc.getMap<string>("formulaValues")),
  );
}
