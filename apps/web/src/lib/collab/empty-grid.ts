import * as Y from "yjs";
import { gridTypes } from "@ripple/shared/spreadsheetDoc";

/**
 * The grid every spreadsheet starts life with.
 *
 * Deliberately small. Every seeded cell is a `Y.Map` entry that is synced,
 * snapshotted and rendered as a `<td>`, so the empty grid is pure cost until
 * someone types in it — 100×30 was 3000 cells of it. One to two screens is
 * enough to start, and the grid grows on demand: typing past the last row,
 * the context menu, or the "add rows / columns" buttons under the grid.
 */
export const DEFAULT_ROWS = 50;
export const DEFAULT_COLS = 12;

/**
 * The row count sheets were seeded with before the reduction above.
 *
 * Only `SpreadsheetYjsBinding.compactRows` uses it: that is the repair path for
 * an old non-idempotent bootstrap that accumulated rows, and it trims trailing
 * empty rows down to this floor. Pointing it at `DEFAULT_ROWS` instead would
 * make every existing 100-row sheet silently lose half its rows on open.
 */
export const LEGACY_DEFAULT_ROWS = 100;

/**
 * The empty state of a spreadsheet grid, as one canonical Yjs update.
 *
 * The same device as `collab/empty-document.ts`, for the same reason: built
 * once under a fixed client id, so every client that applies it applies *the
 * same* rows rather than one of its own. Applying it twice, or from ten
 * devices, is a no-op — which is what stops concurrent bootstrap from
 * accumulating 200 rows in a 100-row sheet.
 *
 * `rowOrder` and `colOrder` are seeded with deterministic ids (`r0..rN`,
 * `c0..cN`) so that concurrent bootstrap produces identical arrays too.
 */
export const EMPTY_SPREADSHEET_UPDATE: Uint8Array = (() => {
  const doc = new Y.Doc();
  doc.clientID = 1; // Fixed ID → applying this update is always idempotent
  const { data, rowOrder, colOrder } = gridTypes(doc);
  const meta = doc.getMap<unknown>("meta");
  doc.transact(() => {
    meta.set("colCount", DEFAULT_COLS);
    for (let r = 0; r < DEFAULT_ROWS; r++) {
      const rowMap = new Y.Map<string>();
      for (let c = 0; c < DEFAULT_COLS; c++) {
        rowMap.set(String(c), "");
      }
      data.push([rowMap]);
    }
    for (let r = 0; r < DEFAULT_ROWS; r++) rowOrder.push([`r${r}`]);
    for (let c = 0; c < DEFAULT_COLS; c++) colOrder.push([`c${c}`]);
  });
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
})();

/**
 * Give a grid its shared empty root, if it has no rows yet.
 *
 * Only safe to call on a replica that is **hydrated** — one holding the room's
 * actual state. On a replica that simply hasn't been told what the spreadsheet
 * contains, this plants a grid beside the real one, and the merge then has two
 * sets of rows claiming the same coordinates.
 *
 * This used to run from `SpreadsheetYjsBinding`'s constructor on a bare
 * `yData.length === 0` check, which made "is this replica hydrated?" a question
 * the binding never asked and its callers answered by deciding whether to mount
 * it. A guest — who has no cache and no cold-start snapshot, so hydrates only
 * on a live sync — mounted it immediately.
 */
export function seedEmptyGrid(yDoc: Y.Doc, origin: unknown): boolean {
  if (gridTypes(yDoc).data.length > 0) return false;
  Y.applyUpdate(yDoc, EMPTY_SPREADSHEET_UPDATE, origin);
  return true;
}
