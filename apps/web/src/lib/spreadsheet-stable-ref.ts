import type * as Y from "yjs";
import { normalizeCellRef } from "@ripple/shared/cellRef";
import { a1ToStable, serializeStableRef } from "@ripple/shared/stableRef";

/**
 * The stable identity of an A1 ref, resolved against a room's own replica.
 *
 * The same answer `spreadsheetCellRefsNode.prepareStableRef` returns, computed
 * where the caller already has the data: that action exists for callers with
 * no replica, and paying for it — a Node action that downloads and decodes the
 * whole snapshot — while a hydrated copy of the very same order arrays sits in
 * the picker the user is looking at is what made inserting a cell reference
 * feel like a network operation.
 *
 * Returns null when the replica cannot answer (not hydrated, a sheet with no
 * order arrays, a ref past the end of the grid). Callers fall back to the
 * action, which reports the reason properly.
 */
export function resolveStableRefLocally(
  yDoc: Y.Doc,
  cellRef: string,
): string | null {
  const rowOrder = yDoc.getArray<string>("rowOrder").toArray();
  const colOrder = yDoc.getArray<string>("colOrder").toArray();
  if (rowOrder.length === 0 || colOrder.length === 0) return null;

  const stable = a1ToStable(normalizeCellRef(cellRef), rowOrder, colOrder);
  return stable ? serializeStableRef(stable) : null;
}
