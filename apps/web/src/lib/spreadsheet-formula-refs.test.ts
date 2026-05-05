import { describe, expect, it } from "vitest";
import { extractCellRefs, getRefInsertContext } from "./spreadsheet-formula-refs";

describe("extractCellRefs", () => {
  it("returns empty for non-formulas", () => {
    expect(extractCellRefs("hello")).toEqual([]);
    expect(extractCellRefs("A1+B2")).toEqual([]);
  });

  it("extracts a single cell ref", () => {
    expect(extractCellRefs("=A1")).toEqual([{ ref: "A1", start: 1, end: 3 }]);
  });

  it("extracts multiple refs in arithmetic", () => {
    expect(extractCellRefs("=A1+B2*C3")).toEqual([
      { ref: "A1", start: 1, end: 3 },
      { ref: "B2", start: 4, end: 6 },
      { ref: "C3", start: 7, end: 9 },
    ]);
  });

  it("extracts a range", () => {
    expect(extractCellRefs("=SUM(A1:B5)")).toEqual([
      { ref: "A1:B5", start: 5, end: 10 },
    ]);
  });

  it("normalizes absolute refs", () => {
    expect(extractCellRefs("=$A$1+$B2")).toEqual([
      { ref: "A1", start: 1, end: 5 },
      { ref: "B2", start: 6, end: 9 },
    ]);
  });

  it("ignores function names that look like cell refs", () => {
    // LOG10( should be excluded because of the trailing `(` lookahead
    const refs = extractCellRefs("=LOG10(A1)");
    expect(refs).toEqual([{ ref: "A1", start: 7, end: 9 }]);
  });

  it("handles lowercase", () => {
    expect(extractCellRefs("=a1+b2")).toEqual([
      { ref: "A1", start: 1, end: 3 },
      { ref: "B2", start: 4, end: 6 },
    ]);
  });
});

describe("getRefInsertContext", () => {
  it("returns null when not a formula", () => {
    expect(getRefInsertContext("hello", 5)).toBeNull();
  });

  it("returns insertion point right after =", () => {
    expect(getRefInsertContext("=", 1)).toEqual({ start: 1, end: 1 });
  });

  it("returns insertion point after operator", () => {
    expect(getRefInsertContext("=A1+", 4)).toEqual({ start: 4, end: 4 });
  });

  it("returns span over an existing ref to replace", () => {
    expect(getRefInsertContext("=A1", 3)).toEqual({ start: 1, end: 3 });
  });

  it("replaces partial ref after open paren", () => {
    expect(getRefInsertContext("=SUM(A1", 7)).toEqual({ start: 5, end: 7 });
  });

  it("returns insertion at colon for range completion", () => {
    expect(getRefInsertContext("=A1:", 4)).toEqual({ start: 4, end: 4 });
  });

  it("returns span when cursor is mid-token after comma", () => {
    expect(getRefInsertContext("=SUM(A1,B2", 10)).toEqual({ start: 8, end: 10 });
  });
});
