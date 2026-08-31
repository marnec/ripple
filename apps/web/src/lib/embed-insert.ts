import { isSingleCell } from "@ripple/shared/cellRef";
import type { BlockPreview } from "@ripple/shared/blockRef";
import type { Id } from "@convex/_generated/dataModel";
import { seedBlockPreview, seedCellPreview } from "./embed-preview-cache";

/**
 * Inserting an embed, in one place.
 *
 * The document editor and the task-description editor both do it, and each
 * used to own a copy — which is how one of them ended up seeding nothing and
 * the other awaiting an action before it would insert anything at all. What
 * they actually differ in is the editor instance and where the dialog state
 * lives; the sequence below is the same for both.
 *
 * The sequence is: show it, then record it. The block goes in with the content
 * the picker was holding, that content is written to this device's copy so the
 * block has something to render before any server has heard of it, and the
 * mutation that creates the tracking row carries the same content so every
 * other reader gets it too. The server's own projection overwrites all of it
 * within the second.
 */

/** The insert surface of a BlockNote editor; the schema generics add nothing here. */
export type EmbedInsertEditor = {
  focus: () => void;
  insertInlineContent: (content: any[]) => void;
  insertBlocks: (blocks: any[], referenceBlock: any, placement: "after") => unknown;
  getTextCursorPosition: () => { block: any };
};

export interface CellRefEmbedPick {
  /** Normalised A1, or null when the field was left blank (link only). */
  cellRef: string | null;
  /** The cell's stable identity, or null when the replica could not resolve it. */
  stableRef: string | null;
  /** What the grid held for `cellRef` at pick time; null for the link pick. */
  values: string[][] | null;
}

export interface InsertCellRefEmbedArgs {
  editor: EmbedInsertEditor;
  spreadsheetId: Id<"spreadsheets">;
  pick: CellRefEmbedPick;
  ensureCellRef: (args: {
    spreadsheetId: Id<"spreadsheets">;
    cellRef: string;
    stableRef: string;
    values?: string[][];
  }) => Promise<null>;
  /** Fallback for a pick whose replica could not resolve the stable identity. */
  prepareStableRef: (args: {
    spreadsheetId: Id<"spreadsheets">;
    cellRef: string;
  }) => Promise<string>;
}

/**
 * Resolves once the embed is in the document.
 *
 * A pick the replica could resolve is inserted **synchronously**, before this
 * returns — that is the whole point of resolving locally, and no caller should
 * have to await it to see the block. The promise exists for the fallback path,
 * and it **rejects** when the server refuses to make the reference (a sheet
 * with no order arrays, a ref past the end of the grid). Nothing is inserted
 * in that case, so a caller that ignores the rejection leaves the user with a
 * dialog that closed and did nothing.
 */
export function insertCellRefEmbed({
  editor,
  spreadsheetId,
  pick,
  ensureCellRef,
  prepareStableRef,
}: InsertCellRefEmbedArgs): Promise<void> {
  const { cellRef, values } = pick;
  editor.focus();

  if (!cellRef) {
    editor.insertInlineContent([
      { type: "spreadsheetLink", props: { spreadsheetId } },
      " ",
    ]);
    return Promise.resolve();
  }

  const place = (stableRef: string) => {
    if (values) seedCellPreview(spreadsheetId, stableRef, cellRef, values);

    if (isSingleCell(cellRef)) {
      editor.insertInlineContent([
        { type: "spreadsheetCellRef", props: { spreadsheetId, cellRef, stableRef } },
        " ",
      ]);
    } else {
      editor.insertBlocks(
        [{ type: "spreadsheetRange", props: { spreadsheetId, cellRef, stableRef } }],
        editor.getTextCursorPosition().block,
        "after",
      );
    }

    void ensureCellRef({
      spreadsheetId,
      cellRef,
      stableRef,
      values: values ?? undefined,
    });
  };

  // The replica answered — nothing to wait for.
  if (pick.stableRef) {
    place(pick.stableRef);
    return Promise.resolve();
  }

  // It could not (a sheet with no order arrays, a ref past the end of the
  // grid). Ask the server, which reports the reason properly, and let the
  // rejection carry it back to whoever can show it.
  return prepareStableRef({ spreadsheetId, cellRef }).then(place);
}

export interface InsertBlockEmbedArgs {
  editor: EmbedInsertEditor;
  documentId: Id<"documents">;
  block: BlockPreview;
  ensureBlockRef: (args: {
    documentId: Id<"documents">;
    blockId: string;
    blockType?: string;
    textContent?: string;
  }) => Promise<null>;
}

export function insertBlockEmbed({
  editor,
  documentId,
  block,
  ensureBlockRef,
}: InsertBlockEmbedArgs): void {
  editor.focus();

  seedBlockPreview(documentId, block.blockId, block.type, block.text);

  editor.insertBlocks(
    [{ type: "documentBlockEmbed", props: { documentId, blockId: block.blockId } }],
    editor.getTextCursorPosition().block,
    "after",
  );

  void ensureBlockRef({
    documentId,
    blockId: block.blockId,
    blockType: block.type,
    textContent: block.text,
  });
}
