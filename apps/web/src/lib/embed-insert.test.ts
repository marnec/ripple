import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  insertBlockEmbed,
  insertCellRefEmbed,
  type EmbedInsertEditor,
} from "./embed-insert";
import {
  blockPreviewKey,
  cellPreviewKey,
  clearEmbedPreviewMemory,
  readEmbedPreviewSync,
} from "./embed-preview-cache";

/**
 * What an insert has to do, in order: put the block in, give this device
 * something to render it from, and tell the server. The order is the point —
 * an embed that waits on the server before appearing is the thing this
 * replaced.
 */

const SPREADSHEET_ID = "sheet1" as Id<"spreadsheets">;
const DOCUMENT_ID = "doc1" as Id<"documents">;

function fakeEditor() {
  const editor = {
    focus: vi.fn(),
    insertInlineContent: vi.fn(),
    insertBlocks: vi.fn(),
    getTextCursorPosition: () => ({ block: { id: "cursor-block" } }),
  };
  return editor as EmbedInsertEditor & typeof editor;
}

beforeEach(() => {
  clearEmbedPreviewMemory();
});

describe("insertCellRefEmbed", () => {
  it("inserts an inline chip for a single cell, with its value cached", () => {
    const editor = fakeEditor();
    const ensureCellRef = vi.fn().mockResolvedValue(null);
    const prepareStableRef = vi.fn();

    void insertCellRefEmbed({
      editor,
      spreadsheetId: SPREADSHEET_ID,
      pick: { cellRef: "A1", stableRef: "stable-1", values: [["42"]] },
      ensureCellRef,
      prepareStableRef,
    });

    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      {
        type: "spreadsheetCellRef",
        props: { spreadsheetId: SPREADSHEET_ID, cellRef: "A1", stableRef: "stable-1" },
      },
      " ",
    ]);
    expect(readEmbedPreviewSync(cellPreviewKey(SPREADSHEET_ID, "stable-1"))).toMatchObject(
      { values: [["42"]] },
    );
    expect(ensureCellRef).toHaveBeenCalledWith({
      spreadsheetId: SPREADSHEET_ID,
      cellRef: "A1",
      stableRef: "stable-1",
      values: [["42"]],
    });
    // The replica answered, so nothing was asked of the server.
    expect(prepareStableRef).not.toHaveBeenCalled();
  });

  it("inserts a block for a range", () => {
    const editor = fakeEditor();

    void insertCellRefEmbed({
      editor,
      spreadsheetId: SPREADSHEET_ID,
      pick: { cellRef: "A1:B2", stableRef: "stable-2", values: [["a", "b"]] },
      ensureCellRef: vi.fn().mockResolvedValue(null),
      prepareStableRef: vi.fn(),
    });

    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [
        {
          type: "spreadsheetRange",
          props: { spreadsheetId: SPREADSHEET_ID, cellRef: "A1:B2", stableRef: "stable-2" },
        },
      ],
      { id: "cursor-block" },
      "after",
    );
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
  });

  it("inserts a plain link when no cell was picked", () => {
    const editor = fakeEditor();
    const ensureCellRef = vi.fn();

    void insertCellRefEmbed({
      editor,
      spreadsheetId: SPREADSHEET_ID,
      pick: { cellRef: null, stableRef: null, values: null },
      ensureCellRef,
      prepareStableRef: vi.fn(),
    });

    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: "spreadsheetLink", props: { spreadsheetId: SPREADSHEET_ID } },
      " ",
    ]);
    expect(ensureCellRef).not.toHaveBeenCalled();
  });

  it("asks the server for the stable identity only when the replica could not", async () => {
    const editor = fakeEditor();
    const ensureCellRef = vi.fn().mockResolvedValue(null);
    const prepareStableRef = vi.fn().mockResolvedValue("stable-from-server");

    void insertCellRefEmbed({
      editor,
      spreadsheetId: SPREADSHEET_ID,
      pick: { cellRef: "A1", stableRef: null, values: null },
      ensureCellRef,
      prepareStableRef,
    });

    // Nothing can be inserted until the identity comes back.
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(editor.insertInlineContent).toHaveBeenCalled());

    expect(prepareStableRef).toHaveBeenCalledWith({
      spreadsheetId: SPREADSHEET_ID,
      cellRef: "A1",
    });
    expect(ensureCellRef).toHaveBeenCalledWith({
      spreadsheetId: SPREADSHEET_ID,
      cellRef: "A1",
      stableRef: "stable-from-server",
      values: undefined,
    });
  });

  it("rejects, inserting nothing, when the server refuses the reference", async () => {
    const editor = fakeEditor();
    const ensureCellRef = vi.fn();

    const inserted = insertCellRefEmbed({
      editor,
      spreadsheetId: SPREADSHEET_ID,
      pick: { cellRef: "A1", stableRef: null, values: null },
      ensureCellRef,
      prepareStableRef: vi
        .fn()
        .mockRejectedValue(new Error("Cell reference is out of bounds")),
    });

    // The reason has to reach the caller: by the time this settles the dialog
    // has closed, so a swallowed rejection is a user staring at a document
    // that gained nothing and said nothing.
    await expect(inserted).rejects.toThrow("Cell reference is out of bounds");
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
    expect(ensureCellRef).not.toHaveBeenCalled();
  });
});

describe("insertBlockEmbed", () => {
  it("inserts the embed and caches the text the picker showed", () => {
    const editor = fakeEditor();
    const ensureBlockRef = vi.fn().mockResolvedValue(null);

    insertBlockEmbed({
      editor,
      documentId: DOCUMENT_ID,
      block: { blockId: "block-1", type: "heading", text: "Quarterly goals" },
      ensureBlockRef,
    });

    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [
        {
          type: "documentBlockEmbed",
          props: { documentId: DOCUMENT_ID, blockId: "block-1" },
        },
      ],
      { id: "cursor-block" },
      "after",
    );
    expect(readEmbedPreviewSync(blockPreviewKey(DOCUMENT_ID, "block-1"))).toMatchObject({
      blockType: "heading",
      textContent: "Quarterly goals",
    });
    expect(ensureBlockRef).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      blockId: "block-1",
      blockType: "heading",
      textContent: "Quarterly goals",
    });
  });
});
