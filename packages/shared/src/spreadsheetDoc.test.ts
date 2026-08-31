import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { a1ToStable, serializeStableRef } from "./stableRef";
import {
  gridOrders,
  gridSource,
  gridTypes,
  readGridRange,
  stableRefForCell,
} from "./spreadsheetDoc";

/**
 * The adapter between a spreadsheet room and the rules in `cellValues` /
 * `stableRef`. Three packages read a grid through it — the web app, the Convex
 * snapshot action and the PartyKit room — and they used to do it through three
 * byte-identical private copies, so what these pin is the shape itself: which
 * types a grid is made of, and that reading them agrees with the pure rules.
 */

function sheet(rows: string[][], orders?: { rowOrder: string[]; colOrder: string[] }): Y.Doc {
  const doc = new Y.Doc();
  const { data, rowOrder, colOrder } = gridTypes(doc);
  for (const row of rows) {
    const map = new Y.Map<string>();
    row.forEach((value, col) => map.set(String(col), value));
    data.push([map]);
  }
  if (orders) {
    rowOrder.insert(0, orders.rowOrder);
    colOrder.insert(0, orders.colOrder);
  }
  return doc;
}

describe("gridTypes", () => {
  it("names the four types a spreadsheet room is made of", () => {
    const doc = new Y.Doc();
    const grid = gridTypes(doc);

    // Same handles the room itself binds to — a second spelling would observe
    // and read a type nobody writes.
    expect(grid.data).toBe(doc.getArray("data"));
    expect(grid.formulaValues).toBe(doc.getMap("formulaValues"));
    expect(grid.rowOrder).toBe(doc.getArray("rowOrder"));
    expect(grid.colOrder).toBe(doc.getArray("colOrder"));
  });
});

describe("gridSource", () => {
  it("reads authored cell values", () => {
    const source = gridSource(sheet([["a", "b"], ["c", "d"]]));

    expect(source.rowCount).toBe(2);
    expect(source.read(1, 0)).toBe("c");
  });

  it("reads a cell that was never written as blank", () => {
    expect(gridSource(sheet([["a"]])).read(0, 5)).toBe("");
  });

  it("exposes the computed value of a formula cell", () => {
    const doc = sheet([["=SUM(A1:A9)"]]);
    gridTypes(doc).formulaValues.set("0,0", "42");

    // Keyed "row,col" — the one place that encoding is written down.
    expect(gridSource(doc).formulaValue?.(0, 0)).toBe("42");
  });
});

describe("readGridRange", () => {
  it("reads a range as a row-major grid", () => {
    expect(readGridRange(sheet([["a", "b"], ["c", "d"]]), "A1:B2")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("shows a formula cell's computed value, not its source", () => {
    const doc = sheet([["=1+1"]]);
    gridTypes(doc).formulaValues.set("0,0", "2");

    expect(readGridRange(doc, "A1")).toEqual([["2"]]);
  });

  it("clips a range that runs past the last row", () => {
    expect(readGridRange(sheet([["a"]]), "A1:A9")).toEqual([["a"]]);
  });
});

describe("gridOrders / stableRefForCell", () => {
  const orders = { rowOrder: ["r1", "r2", "r3"], colOrder: ["c1", "c2"] };

  it("reads the stable id arrays in visual order", () => {
    expect(gridOrders(sheet([], orders))).toEqual(orders);
  });

  it("resolves a cell to the identity the server would compute", () => {
    expect(stableRefForCell(sheet([], orders), "B2")).toBe(
      serializeStableRef(a1ToStable("B2", orders.rowOrder, orders.colOrder)!),
    );
  });

  it("resolves a range, normalising case", () => {
    expect(stableRefForCell(sheet([], orders), "a1:b2")).toBe(
      serializeStableRef(a1ToStable("A1:B2", orders.rowOrder, orders.colOrder)!),
    );
  });

  it("declines a replica holding no order arrays", () => {
    // An unhydrated replica looks exactly like this, so it must not answer.
    expect(stableRefForCell(new Y.Doc(), "A1")).toBeNull();
  });

  it("declines a reference past the end of the grid", () => {
    expect(stableRefForCell(sheet([], { rowOrder: ["r1"], colOrder: ["c1"] }), "C9")).toBeNull();
  });
});
