/**
 * The shape of a spreadsheet room's Yjs document, named once.
 *
 * A spreadsheet room is four shared types:
 *
 *   "data"          → Y.Array<Y.Map<string>>  rows of cells, Y.Map keys are col indices
 *   "formulaValues" → Y.Map<string>           "row,col" → computed display value
 *   "rowOrder"      → Y.Array<string>         stable row ids, in visual order
 *   "colOrder"      → Y.Array<string>         stable col ids, in visual order
 *
 * Every reader of that shape used to re-type it: the web app twice, the Convex
 * snapshot action twice, the PartyKit room three times — and the accessor
 * bundle below existed as three byte-identical private copies. A grid is not a
 * thing you should be able to spell three ways.
 *
 * **The yjs import here is type-only, and must stay that way.** `@ripple/shared`
 * is consumed by two packages that have no yjs runtime (`@ripple/admin`,
 * `@ripple/rsvp-worker`) and by Convex functions that run outside Node, so a
 * value import would push a runtime dependency into all of them. Reading a
 * document someone else constructed needs no such thing: everything here is a
 * method call on a `Y.Doc` the caller already holds. Anything that needs to
 * *build* a document (`new Y.Doc`, `applyUpdate`, `encodeStateAsUpdate`) does
 * not belong in this file — see `apps/web/src/lib/collab/empty-grid.ts`.
 */

import type * as Y from "yjs";
import { normalizeCellRef } from "./cellRef";
import { extractCellValues, type CellSource } from "./cellValues";
import { a1ToStable, serializeStableRef } from "./stableRef";

/** The four shared types a spreadsheet room is made of. */
export interface GridTypes {
  data: Y.Array<Y.Map<string>>;
  formulaValues: Y.Map<string>;
  rowOrder: Y.Array<string>;
  colOrder: Y.Array<string>;
}

/**
 * Handles on a room's shared types.
 *
 * The reason this exists rather than only the readers below: observers need
 * the types themselves, not their contents, and a room that wires
 * `observe`/`unobserve` by hand is a room that can spell `"formulaValues"`
 * correctly in one and wrongly in the other. Cheap to call — `getArray` and
 * `getMap` are idempotent lookups.
 */
export function gridTypes(yDoc: Y.Doc): GridTypes {
  return {
    data: yDoc.getArray<Y.Map<string>>("data"),
    formulaValues: yDoc.getMap<string>("formulaValues"),
    rowOrder: yDoc.getArray<string>("rowOrder"),
    colOrder: yDoc.getArray<string>("colOrder"),
  };
}

/** The row/col stable-id arrays a reference resolves against. */
export interface GridOrders {
  rowOrder: string[];
  colOrder: string[];
}

/**
 * Read accessors over a room's grid, for the rules in `cellValues`.
 *
 * That module deliberately knows nothing about Yjs — the rule for which rect
 * and which value per cell is testable with plain values — so this is the one
 * place the two meet.
 */
export function gridSource(yDoc: Y.Doc): CellSource {
  const { data, formulaValues } = gridTypes(yDoc);
  return {
    rowCount: data.length,
    read: (row, col) => data.get(row)?.get(String(col)) ?? "",
    formulaValue: (row, col) => formulaValues.get(`${row},${col}`),
  };
}

/** The room's stable row and column ids, in visual order. */
export function gridOrders(yDoc: Y.Doc): GridOrders {
  const { rowOrder, colOrder } = gridTypes(yDoc);
  return { rowOrder: rowOrder.toArray(), colOrder: colOrder.toArray() };
}

/**
 * The display values of an A1 cell or range, read from a room's replica.
 *
 * The caller must have established that the replica is **hydrated** — an empty
 * Y.Doc and one that simply hasn't been told anything yet are indistinguishable,
 * so reading an unhydrated replica yields a grid of blanks with no error.
 */
export function readGridRange(yDoc: Y.Doc, cellRef: string): string[][] | null {
  return extractCellValues(cellRef, gridSource(yDoc));
}

/**
 * The stable identity of an A1 ref, resolved against a room's replica.
 *
 * The same answer `spreadsheetCellRefsNode.prepareStableRef` computes from the
 * stored snapshot. Returns null when the replica cannot answer — it is not
 * hydrated, the sheet has no order arrays, or the ref runs past the end of the
 * grid — so a caller with a server path can fall back to it for the reason.
 */
export function stableRefForCell(yDoc: Y.Doc, cellRef: string): string | null {
  const { rowOrder, colOrder } = gridOrders(yDoc);
  if (rowOrder.length === 0 || colOrder.length === 0) return null;

  const stable = a1ToStable(normalizeCellRef(cellRef), rowOrder, colOrder);
  return stable ? serializeStableRef(stable) : null;
}
