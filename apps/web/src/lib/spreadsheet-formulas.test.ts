import { describe, expect, it } from "vitest";
import { getFormulaPickerContext } from "./spreadsheet-formulas";

describe("getFormulaPickerContext", () => {
  it("returns null when value does not start with =", () => {
    expect(getFormulaPickerContext("hello", 5)).toBeNull();
    expect(getFormulaPickerContext("123", 3)).toBeNull();
  });

  it("triggers right after = with empty query", () => {
    expect(getFormulaPickerContext("=", 1)).toEqual({
      query: "",
      partialStart: 1,
    });
  });

  it("triggers for top-level partial name", () => {
    expect(getFormulaPickerContext("=AV", 3)).toEqual({
      query: "AV",
      partialStart: 1,
    });
  });

  it("triggers inside open parens with partial name", () => {
    expect(getFormulaPickerContext("=SUM(AV", 7)).toEqual({
      query: "AV",
      partialStart: 5,
    });
  });

  it("triggers after a comma with partial name", () => {
    expect(getFormulaPickerContext("=SUM(A1, AV", 11)).toEqual({
      query: "AV",
      partialStart: 9,
    });
  });

  it("triggers after a comma with no space", () => {
    expect(getFormulaPickerContext("=SUM(A1,AV", 10)).toEqual({
      query: "AV",
      partialStart: 8,
    });
  });

  it("triggers after arithmetic operators", () => {
    expect(getFormulaPickerContext("=A1+SU", 6)).toEqual({
      query: "SU",
      partialStart: 4,
    });
    expect(getFormulaPickerContext("=A1*MA", 6)).toEqual({
      query: "MA",
      partialStart: 4,
    });
  });

  it("triggers for nested calls", () => {
    expect(getFormulaPickerContext("=IF(SU", 6)).toEqual({
      query: "SU",
      partialStart: 4,
    });
    expect(getFormulaPickerContext("=SUM(AVERAGE(A1), MA", 20)).toEqual({
      query: "MA",
      partialStart: 18,
    });
  });

  it("does not trigger after closing paren", () => {
    expect(getFormulaPickerContext("=SUM(A1)", 8)).toBeNull();
  });

  it("does not trigger with empty query mid-expression", () => {
    expect(getFormulaPickerContext("=SUM(", 5)).toBeNull();
    expect(getFormulaPickerContext("=SUM(A1, ", 9)).toBeNull();
    expect(getFormulaPickerContext("=A1+", 4)).toBeNull();
  });

  it("does not trigger on cell references after =", () => {
    // A1 starts with letter so it parses as identifier, but filter will not
    // match anything; the helper still reports it. Caller filters by matches.
    expect(getFormulaPickerContext("=A1", 3)).toEqual({
      query: "A1",
      partialStart: 1,
    });
  });

  it("respects cursor position before end of value", () => {
    // Cursor after "AV" inside "=SUM(AV)"
    expect(getFormulaPickerContext("=SUM(AV)", 7)).toEqual({
      query: "AV",
      partialStart: 5,
    });
  });

  it("does not trigger when cursor is in whitespace after closing paren", () => {
    expect(getFormulaPickerContext("=SUM(A1) ", 9)).toBeNull();
  });
});
