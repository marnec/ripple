import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { gridTypes } from "@ripple/shared/spreadsheetDoc";
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  seedEmptyGrid,
} from "@/lib/collab/empty-grid";
import { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";

/**
 * The binding's half of the jspreadsheet contract, tested without jspreadsheet.
 *
 * The grid's structural callbacks are the awkward part of that contract: what
 * `oninsertrow` receives is not "where the user clicked" but the *final* index
 * of every row inserted (jspreadsheet-ce's `insertRow` builds them as
 * `row: i + rowNumber + (insertBefore ? 0 : 1)`). Calling them directly is
 * exactly what the real worksheet does, so the fake below only has to absorb
 * the calls the binding makes back at it.
 */
function fakeWorksheet() {
  return {
    ignoreHistory: false,
    rows: [] as unknown[],
    options: { columns: [] as unknown[] },
    setData: vi.fn(),
    insertRow: vi.fn(),
    insertColumn: vi.fn(),
    deleteRow: vi.fn(),
    setValueFromCoords: vi.fn(),
    setWidth: vi.fn(),
    setHeight: vi.fn(),
    setStyle: vi.fn(),
    setMerge: vi.fn(),
  };
}

describe("SpreadsheetYjsBinding structural edits", () => {
  let doc: Y.Doc;
  let worksheet: ReturnType<typeof fakeWorksheet>;
  let binding: SpreadsheetYjsBinding;

  beforeEach(() => {
    doc = new Y.Doc();
    seedEmptyGrid(doc, "test");
    worksheet = fakeWorksheet();
    binding = new SpreadsheetYjsBinding(worksheet, doc, null);
    return () => {
      binding.destroy();
      doc.destroy();
    };
  });

  it("seeds the grid the worksheet is created with", () => {
    const { data, rowOrder, colOrder } = gridTypes(doc);
    expect(data.length).toBe(DEFAULT_ROWS);
    expect(rowOrder.length).toBe(DEFAULT_ROWS);
    expect(colOrder.length).toBe(DEFAULT_COLS);
  });

  it("appends exactly as many rows as jspreadsheet reports", () => {
    const rows = [
      { row: DEFAULT_ROWS, data: [] },
      { row: DEFAULT_ROWS + 1, data: [] },
      { row: DEFAULT_ROWS + 2, data: [] },
    ];
    binding.oninsertrow(null, rows);

    const { data, rowOrder } = gridTypes(doc);
    expect(data.length).toBe(DEFAULT_ROWS + 3);
    // The row ids must keep pace — a short rowOrder breaks every stable cell
    // reference resolved against it.
    expect(rowOrder.length).toBe(DEFAULT_ROWS + 3);
    expect(new Set(rowOrder.toArray()).size).toBe(DEFAULT_ROWS + 3);
  });

  it("keeps existing rows in place when inserting in the middle", () => {
    const { data } = gridTypes(doc);
    data.get(1).set("0", "second");

    binding.oninsertrow(null, [
      { row: 1, data: [] },
      { row: 2, data: [] },
    ]);

    expect(data.length).toBe(DEFAULT_ROWS + 2);
    expect(data.get(1).get("0")).toBe("");
    expect(data.get(2).get("0")).toBe("");
    expect(data.get(3).get("0")).toBe("second");
  });

  it("widens every row when columns are appended", () => {
    binding.oninsertcolumn(null, [
      { column: DEFAULT_COLS, options: {} },
      { column: DEFAULT_COLS + 1, options: {} },
    ]);

    const { data, colOrder } = gridTypes(doc);
    expect(doc.getMap("meta").get("colCount")).toBe(DEFAULT_COLS + 2);
    expect(colOrder.length).toBe(DEFAULT_COLS + 2);
    expect(data.get(0).get(String(DEFAULT_COLS + 1))).toBe("");
  });

  it("grows the sheet through the worksheet, which reports back", () => {
    binding.appendRows(20);
    binding.appendColumns(5);

    // No index: jspreadsheet clamps to the end, which is the whole point.
    expect(worksheet.insertRow).toHaveBeenLastCalledWith(20);
    expect(worksheet.insertColumn).toHaveBeenLastCalledWith(5);
  });

  it("ignores a non-positive step", () => {
    worksheet.insertRow.mockClear();
    worksheet.insertColumn.mockClear();
    binding.appendRows(0);
    binding.appendColumns(-1);

    expect(worksheet.insertRow).not.toHaveBeenCalled();
    expect(worksheet.insertColumn).not.toHaveBeenCalled();
  });
});
