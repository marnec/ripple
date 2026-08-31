import { describe, expect, it } from "vitest";
import {
  applyRefPick,
  extractCellRefs,
  formatSelectionRef,
  getRefInsertContext,
  selectionFromDrag,
} from "./spreadsheet-formula-refs";

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

describe("formatSelectionRef", () => {
  it("formats a single-cell box as one ref", () => {
    expect(formatSelectionRef({ row: 0, col: 0, endRow: 0, endCol: 0 })).toBe("A1");
  });

  it("formats a box as a range", () => {
    expect(formatSelectionRef({ row: 0, col: 0, endRow: 4, endCol: 1 })).toBe("A1:B5");
  });

  it("handles multi-letter columns", () => {
    expect(formatSelectionRef({ row: 1, col: 26, endRow: 2, endCol: 27 })).toBe(
      "AA2:AB3",
    );
  });
});

describe("selectionFromDrag", () => {
  it("normalizes a drag that runs up and to the left", () => {
    expect(selectionFromDrag({ row: 4, col: 3 }, { row: 1, col: 1 })).toEqual({
      row: 1,
      col: 1,
      endRow: 4,
      endCol: 3,
    });
  });

  it("keeps a single-cell drag single", () => {
    expect(selectionFromDrag({ row: 2, col: 2 }, { row: 2, col: 2 })).toEqual({
      row: 2,
      col: 2,
      endRow: 2,
      endCol: 2,
    });
  });
});

describe("applyRefPick", () => {
  it("inserts at the cursor when there is no span", () => {
    expect(applyRefPick("=SUM(", 5, "A1", null)).toEqual({
      text: "=SUM(A1",
      cursor: 7,
      span: { start: 5, end: 7 },
    });
  });

  it("replaces the ref straddling the cursor", () => {
    expect(applyRefPick("=A1", 3, "B2", null)).toEqual({
      text: "=B2",
      cursor: 3,
      span: { start: 1, end: 3 },
    });
  });

  it("grows one ref across a drag instead of appending", () => {
    // Each step feeds the previous step's span, as a drag does.
    const first = applyRefPick("=SUM(", 5, "A1", null);
    const second = applyRefPick(first.text, first.cursor, "A1:B5", first.span);
    const third = applyRefPick(second.text, second.cursor, "A1:C9", second.span);
    expect(third.text).toBe("=SUM(A1:C9");
    expect(third.cursor).toBe(10);
    expect(third.span).toEqual({ start: 5, end: 10 });
  });

  it("preserves text after the insertion point", () => {
    expect(applyRefPick("=SUM(,B2)", 5, "A1", null)).toEqual({
      text: "=SUM(A1,B2)",
      cursor: 7,
      span: { start: 5, end: 7 },
    });
  });
});
