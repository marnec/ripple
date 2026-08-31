import { describe, expect, it } from "vitest";
import { hasHeaderRow, isNumericCell, trimSnapshotRange } from "./spreadsheet-snapshot";

describe("trimSnapshotRange", () => {
  it("drops the blank rim and renames the range to what survived", () => {
    // The shape that started this: a drag that overshot the two filled cells.
    const picked = [
      ["", "", ""],
      ["", "", "adrsgfa"],
      ["cacca", "", "fgsfg"],
      ["", "", ""],
    ];

    expect(trimSnapshotRange(picked, "A1:C4")).toEqual({
      values: [
        ["", "", "adrsgfa"],
        ["cacca", "", "fgsfg"],
      ],
      cellRef: "A2:C3",
    });
  });

  it("keeps blank rows and columns that sit between data", () => {
    const picked = [
      ["a", "", "b"],
      ["", "", ""],
      ["c", "", "d"],
    ];

    expect(trimSnapshotRange(picked, "B2:D4")?.values).toEqual(picked);
    expect(trimSnapshotRange(picked, "B2:D4")?.cellRef).toBe("B2:D4");
  });

  it("collapses to a single-cell reference when one cell is left", () => {
    expect(trimSnapshotRange([["", ""], ["", "42"]], "A1:B2")).toEqual({
      values: [["42"]],
      cellRef: "B2",
    });
  });

  it("returns null for an all-blank range so the sender gets the chip alone", () => {
    expect(trimSnapshotRange([["", " "], ["", ""]], "A1:B2")).toBeNull();
  });

  it("treats missing rows in the read values as blank", () => {
    // `readRangeValues` returns short rows for cells that were never written.
    expect(trimSnapshotRange([["x"]], "A1:C3")).toEqual({
      values: [["x"]],
      cellRef: "A1",
    });
  });

  it("returns null when the reference does not parse", () => {
    expect(trimSnapshotRange([["x"]], "not-a-range")).toBeNull();
  });
});

describe("isNumericCell", () => {
  it("accepts the shapes a sheet formats numbers into", () => {
    for (const value of ["42", "-3.5", "+7", ".5", "1,204", "$1,204.00", "12%", "(38)", " 9 "]) {
      expect(isNumericCell(value), value).toBe(true);
    }
  });

  it("rejects labels, blanks and mixed text", () => {
    for (const value of ["", "  ", "Q3", "12 units", "N/A", "2026-01-04", "-"]) {
      expect(isNumericCell(value), value).toBe(false);
    }
  });
});

describe("hasHeaderRow", () => {
  it("reads a text first row over numeric data as column labels", () => {
    expect(
      hasHeaderRow([
        ["Region", "Revenue"],
        ["North", "1,204"],
      ]),
    ).toBe(true);
  });

  it("does not promote a first row that is itself data", () => {
    expect(
      hasHeaderRow([
        ["1", "2"],
        ["3", "4"],
      ]),
    ).toBe(false);
  });

  it("does not promote when nothing below is numeric", () => {
    expect(
      hasHeaderRow([
        ["alpha", "beta"],
        ["gamma", "delta"],
      ]),
    ).toBe(false);
  });

  it("needs a row underneath and a label to show", () => {
    expect(hasHeaderRow([["Region", "Revenue"]])).toBe(false);
    expect(hasHeaderRow([["", ""], ["1", "2"]])).toBe(false);
  });
});
