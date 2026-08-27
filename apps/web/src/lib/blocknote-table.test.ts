import { describe, expect, it } from "vitest";
import { tableCellContent, tableCellSpans } from "./blocknote-table";

const text = (t: string) => ({ type: "text", text: t, styles: {} });

describe("tableCellContent", () => {
  it("reads the object form the editor produces today", () => {
    const cell = { type: "tableCell", props: {}, content: [text("hi")] };
    expect(tableCellContent(cell)).toEqual([text("hi")]);
  });

  it("reads the bare inline-array form older bodies carry", () => {
    expect(tableCellContent([text("hi")])).toEqual([text("hi")]);
  });

  it("flattens a bare form that nested its inline array one level deeper", () => {
    expect(tableCellContent([[text("hi")]])).toEqual([text("hi")]);
  });

  it("reads an empty cell of either shape as no content", () => {
    expect(tableCellContent({ type: "tableCell", props: {}, content: [] })).toEqual([]);
    expect(tableCellContent([])).toEqual([]);
    expect(tableCellContent(undefined)).toEqual([]);
    expect(tableCellContent({ type: "tableCell" })).toEqual([]);
  });
});

describe("tableCellSpans", () => {
  it("passes merged spans through", () => {
    expect(tableCellSpans({ type: "tableCell", props: { colspan: 2, rowspan: 3 } })).toEqual({
      colSpan: 2,
      rowSpan: 3,
    });
  });

  it("omits a span of 1, which <td> treats as absent anyway", () => {
    expect(tableCellSpans({ type: "tableCell", props: { colspan: 1, rowspan: 1 } })).toEqual({
      colSpan: undefined,
      rowSpan: undefined,
    });
  });

  it("has nothing to say about the bare form, which cannot merge", () => {
    expect(tableCellSpans([text("hi")])).toEqual({});
  });
});
