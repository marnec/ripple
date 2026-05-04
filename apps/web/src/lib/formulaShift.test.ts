import { describe, expect, it } from "vitest";
import { shiftFormula, type ShiftOp } from "./formulaShift";

const insertRow = (index: number, count = 1): ShiftOp => ({ type: "insertRow", index, count });
const deleteRow = (index: number, count = 1): ShiftOp => ({ type: "deleteRow", index, count });
const insertCol = (index: number, count = 1): ShiftOp => ({ type: "insertCol", index, count });
const deleteCol = (index: number, count = 1): ShiftOp => ({ type: "deleteCol", index, count });

describe("shiftFormula — single cell refs", () => {
  it("shifts =A1+B2 down on insertRow above row 1", () => {
    expect(shiftFormula("=A1+B2", insertRow(0))).toBe("=A2+B3");
  });

  it("collapses =A5 to #REF! when its row is deleted", () => {
    expect(shiftFormula("=A5", deleteRow(4))).toBe("=#REF!");
  });

  it("shifts =A5 up to =A4 when an earlier row is deleted", () => {
    expect(shiftFormula("=A5", deleteRow(3))).toBe("=A4");
  });

  it("leaves =A1 unchanged when a later row is deleted", () => {
    expect(shiftFormula("=A1", deleteRow(5))).toBe("=A1");
  });

  it("shifts =A1 right on insertCol at col A", () => {
    expect(shiftFormula("=A1", insertCol(0))).toBe("=B1");
  });

  it("collapses =A1 to #REF! when col A is deleted", () => {
    expect(shiftFormula("=A1", deleteCol(0))).toBe("=#REF!");
  });

  it("preserves $ row lock on output but still collapses on delete", () => {
    expect(shiftFormula("=$A$1", deleteRow(0))).toBe("=#REF!");
  });

  it("preserves $ markers when shifting absolute refs (Excel adjusts absolutes too)", () => {
    expect(shiftFormula("=$A$1", insertRow(0))).toBe("=$A$2");
    expect(shiftFormula("=$A$1", insertCol(0))).toBe("=$B$1");
  });
});

describe("shiftFormula — ranges", () => {
  it("shrinks =SUM(A1:A5) to =SUM(A1:A4) on interior row delete", () => {
    expect(shiftFormula("=SUM(A1:A5)", deleteRow(2))).toBe("=SUM(A1:A4)");
  });

  it("collapses =SUM(A1:A5) to =SUM(#REF!) when entire range is deleted", () => {
    expect(shiftFormula("=SUM(A1:A5)", deleteRow(0, 5))).toBe("=SUM(#REF!)");
  });

  it("clips start endpoint inside deleted span; shifts end", () => {
    expect(shiftFormula("=SUM(A1:A5)", deleteRow(0))).toBe("=SUM(A1:A4)");
  });

  it("clips end endpoint inside deleted span", () => {
    expect(shiftFormula("=SUM(A1:A5)", deleteRow(4))).toBe("=SUM(A1:A4)");
  });

  it("expands range on insertRow inside the range", () => {
    expect(shiftFormula("=SUM(A1:A5)", insertRow(2))).toBe("=SUM(A1:A6)");
  });

  it("shifts column ranges symmetrically — interior col delete", () => {
    expect(shiftFormula("=SUM(A1:C1)", deleteCol(1))).toBe("=SUM(A1:B1)");
  });

  it("collapses to #REF! when both endpoints inside a multi-row delete span", () => {
    expect(shiftFormula("=SUM(A1:A5)", deleteRow(1, 3))).toBe("=SUM(A1:A2)");
  });
});

describe("shiftFormula — string literals", () => {
  it("preserves string literals containing = and ,", () => {
    expect(shiftFormula(`=IF(A1>0,"=delete me",B1)`, insertRow(0))).toBe(
      `=IF(A2>0,"=delete me",B2)`,
    );
  });

  it("preserves embedded escaped quotes (\"\")", () => {
    expect(shiftFormula(`=A1&"say ""hi""!"&B1`, insertRow(0))).toBe(
      `=A2&"say ""hi""!"&B2`,
    );
  });

  it("does not parse refs inside strings", () => {
    expect(shiftFormula(`="A1+B2"`, deleteRow(0))).toBe(`="A1+B2"`);
  });
});

describe("shiftFormula — edge cases", () => {
  it("returns input unchanged when not a formula", () => {
    expect(shiftFormula("hello", insertRow(0))).toBe("hello");
    expect(shiftFormula("123", insertRow(0))).toBe("123");
    expect(shiftFormula("", insertRow(0))).toBe("");
  });

  it("does not parse SUM(...) function name as a cell ref", () => {
    expect(shiftFormula("=SUM(A1)", insertRow(0))).toBe("=SUM(A2)");
  });

  it("does not parse SUM12( as a cell ref", () => {
    // SUM12 looks ref-like but the trailing ( disqualifies it.
    expect(shiftFormula("=SUM12(A1)", insertRow(0))).toBe("=SUM12(A2)");
  });

  it("handles multi-letter columns", () => {
    expect(shiftFormula("=AA1+AB2", insertRow(0))).toBe("=AA2+AB3");
  });

  it("supports multi-row insert", () => {
    expect(shiftFormula("=A5", insertRow(0, 3))).toBe("=A8");
  });

  it("supports multi-col delete past the ref", () => {
    // col 3 (=D), delete cols 0-1 (A,B) → col 1 (=B)
    expect(shiftFormula("=D1", deleteCol(0, 2))).toBe("=B1");
  });
});
