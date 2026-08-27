import { describe, expect, it } from "vitest";
import { extractCellValues } from "@ripple/shared/cellValues";

/** A grid literal, row-major, as the source accessors see it. */
function source(rows: string[][], formulas: Record<string, string> = {}) {
  return {
    rowCount: rows.length,
    read: (row: number, col: number) => rows[row]?.[col] ?? "",
    formulaValue: (row: number, col: number) => formulas[`${row},${col}`],
  };
}

const GRID = [
  ["a1", "b1", "c1"],
  ["a2", "b2", "c2"],
  ["a3", "b3", "c3"],
];

describe("extractCellValues", () => {
  it("reads a rectangular range row-major", () => {
    expect(extractCellValues("A1:B2", source(GRID))).toEqual([
      ["a1", "b1"],
      ["a2", "b2"],
    ]);
  });

  it("reads a single cell as a 1x1 grid", () => {
    expect(extractCellValues("B2", source(GRID))).toEqual([["b2"]]);
  });

  it("reads blanks for cells that were never written", () => {
    expect(extractCellValues("A1:C1", source([["only"]]))).toEqual([["only", "", ""]]);
  });

  it("clips a range that runs past the last row rather than padding it", () => {
    expect(extractCellValues("A1:A9", source(GRID))).toEqual([["a1"], ["a2"], ["a3"]]);
  });

  it("reads a single cell past the last row as blank", () => {
    expect(extractCellValues("A9", source(GRID))).toEqual([[""]]);
  });

  it("shows a formula's computed value, not its source", () => {
    const values = extractCellValues(
      "A1:A2",
      source([["=SUM(B1:B9)"], ["plain"]], { "0,0": "42" }),
    );
    expect(values).toEqual([["42"], ["plain"]]);
  });

  it("falls back to the formula text when nothing has been computed yet", () => {
    expect(extractCellValues("A1", source([["=SUM(B1:B9)"]]))).toEqual([["=SUM(B1:B9)"]]);
  });

  it("returns null for an unparseable ref", () => {
    expect(extractCellValues("not-a-ref", source(GRID))).toBeNull();
    expect(extractCellValues("A1:zzz", source(GRID))).toBeNull();
  });
});
