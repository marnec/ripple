import { describe, expect, it } from "vitest";
import { spreadsheetSnapshotToText } from "../convex/lib/spreadsheetText";
import { gridSnapshot } from "./yjsFixtures";

/**
 * How a spreadsheet reads to the model: a markdown table of what the cells
 * show — computed values, never formulas — capped by rows.
 */
describe("spreadsheetSnapshotToText", () => {
  it("renders the grid as a markdown table of displayed values", () => {
    const text = spreadsheetSnapshotToText(
      gridSnapshot(
        [
          ["Item", "Qty", "Price", "Total"],
          ["Widget", "2", "3.50", "=B2*C2"],
        ],
        { "1,3": "7.00" },
      ),
    );
    expect(text).toContain("| A | B | C | D |");
    expect(text).toContain("| Item | Qty | Price | Total |");
    expect(text).toContain("| Widget | 2 | 3.50 | 7.00 |");
    expect(text).not.toContain("=B2*C2");
  });

  it("renders an empty grid as empty text", () => {
    expect(spreadsheetSnapshotToText(gridSnapshot([]))).toBe("");
  });

  it("caps the rows and says how many were left out", () => {
    const rows = Array.from({ length: 205 }, (_, i) => [`row ${i + 1}`]);
    const text = spreadsheetSnapshotToText(gridSnapshot(rows), { maxRows: 200 });
    expect(text).toContain("| row 200 |");
    expect(text).not.toContain("| row 201 |");
    expect(text).toMatch(/5 more rows/);
  });

  it("keeps rows and columns in their visual order", () => {
    const text = spreadsheetSnapshotToText(gridSnapshot([["a", "b"], ["c", "d"]]));
    expect(text.indexOf("| a | b |")).toBeLessThan(text.indexOf("| c | d |"));
  });
});
