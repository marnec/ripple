import { describe, expect, it } from "vitest";
import { planFormulaShift } from "./planFormulaShift";

describe("planFormulaShift", () => {
  it("returns no rewrites for cells without formulas", () => {
    const cells = [
      ["1", "2", "3"],
      ["4", "5", "6"],
    ];
    expect(planFormulaShift(cells, { type: "insertCol", index: 0, count: 1 })).toEqual([]);
  });

  it("shifts single-cell refs right when a column is inserted before them", () => {
    const cells = [
      ["", "", "=A1+B1"],
      ["", "", "=SUM(A1:B5)"],
    ];
    expect(
      planFormulaShift(cells, { type: "insertCol", index: 0, count: 1 }),
    ).toEqual([
      { row: 0, col: 2, next: "=B1+C1" },
      { row: 1, col: 2, next: "=SUM(B1:C5)" },
    ]);
  });

  it("shifts range refs down when rows are inserted above them", () => {
    const cells = [
      ["", "=SUM(A2:A5)"],
    ];
    expect(
      planFormulaShift(cells, { type: "insertRow", index: 0, count: 2 }),
    ).toEqual([{ row: 0, col: 1, next: "=SUM(A4:A7)" }]);
  });

  it("collapses single-cell refs to #REF! when the referenced column is deleted", () => {
    const cells = [["=A1+B1", "", ""]];
    expect(
      planFormulaShift(cells, { type: "deleteCol", index: 0, count: 1 }),
    ).toEqual([{ row: 0, col: 0, next: "=#REF!+A1" }]);
  });

  it("skips cells where the formula text does not actually change", () => {
    // refs are below the deleted col, so they don't shift
    const cells = [["=B1+C1"]];
    expect(
      planFormulaShift(cells, { type: "deleteCol", index: 5, count: 1 }),
    ).toEqual([]);
  });

  it("handles a sparse grid (jagged rows)", () => {
    const cells = [
      ["=A1"],
      ["", "=B2", ""],
      [],
    ];
    expect(
      planFormulaShift(cells, { type: "insertRow", index: 0, count: 1 }),
    ).toEqual([
      { row: 0, col: 0, next: "=A2" },
      { row: 1, col: 1, next: "=B3" },
    ]);
  });

  it("ignores empty strings and non-formula content", () => {
    const cells = [
      ["", "hello", "=A1"],
      ["world", "", null as unknown as string],
    ];
    expect(
      planFormulaShift(cells, { type: "insertCol", index: 0, count: 1 }),
    ).toEqual([{ row: 0, col: 2, next: "=B1" }]);
  });
});
