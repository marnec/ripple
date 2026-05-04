import { describe, expect, it } from "vitest";
import {
  a1ToStable,
  parseStableRef,
  resolveStableRef,
  serializeStableRef,
  type StableRef,
} from "@ripple/shared/stableRef";

const rowOrder = ["r0", "r1", "r2", "r3", "r4"];
const colOrder = ["c0", "c1", "c2", "c3"];

describe("a1ToStable", () => {
  it("converts a single A1 to stable cell ref", () => {
    expect(a1ToStable("A1", rowOrder, colOrder)).toEqual({ rowId: "r0", colId: "c0" });
  });

  it("converts A1:C3 to stable range ref", () => {
    expect(a1ToStable("A1:C3", rowOrder, colOrder)).toEqual({
      startRowId: "r0",
      startColId: "c0",
      endRowId: "r2",
      endColId: "c2",
    });
  });

  it("returns null when row index is out of range", () => {
    expect(a1ToStable("A99", rowOrder, colOrder)).toBeNull();
  });

  it("returns null for invalid A1", () => {
    expect(a1ToStable("not-a-ref", rowOrder, colOrder)).toBeNull();
  });
});

describe("resolveStableRef — single cell", () => {
  it("returns ok with current A1 when both IDs present", () => {
    const ref: StableRef = { rowId: "r2", colId: "c1" };
    const result = resolveStableRef(ref, rowOrder, colOrder);
    expect(result).toEqual({ ok: true, a1: "B3", row: 2, col: 1 });
  });

  it("tracks the cell after a row is inserted before it", () => {
    // Original: r2 was at position 2 (A1 = B3). Insert a row at position 0:
    const newRowOrder = ["rNew", ...rowOrder];
    const ref: StableRef = { rowId: "r2", colId: "c1" };
    const result = resolveStableRef(ref, newRowOrder, colOrder);
    expect(result).toEqual({ ok: true, a1: "B4", row: 3, col: 1 });
  });

  it("orphans when rowId is missing", () => {
    const ref: StableRef = { rowId: "rMissing", colId: "c0" };
    expect(resolveStableRef(ref, rowOrder, colOrder)).toEqual({
      ok: false,
      missing: ["startRow"],
    });
  });

  it("orphans when colId is missing", () => {
    const ref: StableRef = { rowId: "r0", colId: "cMissing" };
    expect(resolveStableRef(ref, rowOrder, colOrder)).toEqual({
      ok: false,
      missing: ["startCol"],
    });
  });

  it("reports both missing when row and col both gone", () => {
    const ref: StableRef = { rowId: "rMissing", colId: "cMissing" };
    expect(resolveStableRef(ref, rowOrder, colOrder)).toEqual({
      ok: false,
      missing: ["startRow", "startCol"],
    });
  });
});

describe("resolveStableRef — range", () => {
  it("resolves a range to current A1", () => {
    const ref: StableRef = {
      startRowId: "r0",
      startColId: "c0",
      endRowId: "r2",
      endColId: "c2",
    };
    const result = resolveStableRef(ref, rowOrder, colOrder);
    expect(result).toMatchObject({ ok: true, a1: "A1:C3" });
  });

  it("orphans range when start endpoint is gone", () => {
    const ref: StableRef = {
      startRowId: "rGone",
      startColId: "c0",
      endRowId: "r2",
      endColId: "c2",
    };
    expect(resolveStableRef(ref, rowOrder, colOrder)).toEqual({
      ok: false,
      missing: ["startRow"],
    });
  });

  it("range survives interior row deletion (other endpoints still resolve)", () => {
    // Delete r1 from the order array; r0 and r2 still present
    const newRowOrder = ["r0", "r2", "r3", "r4"];
    const ref: StableRef = {
      startRowId: "r0",
      startColId: "c0",
      endRowId: "r2",
      endColId: "c2",
    };
    const result = resolveStableRef(ref, newRowOrder, colOrder);
    // r2 is now at index 1 → A1:C2
    expect(result).toMatchObject({ ok: true, a1: "A1:C2" });
  });
});

describe("serializeStableRef / parseStableRef", () => {
  it("round-trips a cell ref", () => {
    const ref: StableRef = { rowId: "r0", colId: "c0" };
    expect(parseStableRef(serializeStableRef(ref))).toEqual(ref);
  });

  it("round-trips a range ref", () => {
    const ref: StableRef = {
      startRowId: "r0",
      startColId: "c0",
      endRowId: "r2",
      endColId: "c2",
    };
    expect(parseStableRef(serializeStableRef(ref))).toEqual(ref);
  });

  it("returns null for empty input", () => {
    expect(parseStableRef("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseStableRef("{not valid")).toBeNull();
  });

  it("returns null for JSON with wrong shape", () => {
    expect(parseStableRef('{"foo":"bar"}')).toBeNull();
  });
});
