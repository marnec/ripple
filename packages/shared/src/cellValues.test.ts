import { describe, expect, it } from "vitest";
import { extractCellValues, isBlankGrid, type CellSource } from "./cellValues";

/**
 * The rule for *which* rect and *which* value per cell, exercised the way the
 * module is built to be exercised — with plain values and no Yjs. That is the
 * whole reason `extractCellValues` takes accessors instead of a container, and
 * until now the file claimed the benefit without collecting it.
 */

/** A grid from a row-major array of authored values. */
function grid(rows: string[][], computed: Record<string, string> = {}): CellSource {
  return {
    rowCount: rows.length,
    read: (row, col) => rows[row]?.[col] ?? "",
    formulaValue: (row, col) => computed[`${row},${col}`],
  };
}

describe("extractCellValues", () => {
  it("reads a single cell", () => {
    expect(extractCellValues("B1", grid([["a", "b"]]))).toEqual([["b"]]);
  });

  it("reads a range row-major", () => {
    expect(extractCellValues("A1:B2", grid([["a", "b"], ["c", "d"]]))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("normalises a range written end-first", () => {
    expect(extractCellValues("B2:A1", grid([["a", "b"], ["c", "d"]]))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("clips a range that runs past the last row rather than padding it", () => {
    expect(extractCellValues("A1:A9", grid([["a"]]))).toEqual([["a"]]);
  });

  it("reads a single cell past the last row as blank", () => {
    expect(extractCellValues("A9", grid([["a"]]))).toEqual([[""]]);
  });

  it("shows a formula's computed value in place of its source", () => {
    expect(extractCellValues("A1", grid([["=1+1"]], { "0,0": "2" }))).toEqual([["2"]]);
  });

  it("shows the formula source while nothing has been computed yet", () => {
    // Better than reading as blank for the moment before the evaluator catches up.
    expect(extractCellValues("A1", grid([["=SUM(A1:A9)"]]))).toEqual([["=SUM(A1:A9)"]]);
  });

  it("refuses a ref it cannot parse", () => {
    expect(extractCellValues("nonsense", grid([["a"]]))).toBeNull();
    expect(extractCellValues("A1:", grid([["a"]]))).toBeNull();
  });
});

describe("isBlankGrid", () => {
  it("is true for a grid of empty cells", () => {
    expect(isBlankGrid([["", ""], ["", ""]])).toBe(true);
  });

  it("is true for a grid with no rows", () => {
    expect(isBlankGrid([])).toBe(true);
  });

  it("treats whitespace as blank", () => {
    // It renders identically to an empty cell, so it must count as one.
    expect(isBlankGrid([[" ", "\t"]])).toBe(true);
  });

  it("is false when any cell holds something", () => {
    expect(isBlankGrid([["", "0"]])).toBe(false);
  });
});
