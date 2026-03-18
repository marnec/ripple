import { isSingleCell } from "@shared/cellRef";
import { FileText, PenTool, Table } from "lucide-react";
import { createElement } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import type { DocumentSchemaEditor } from "./schema";

interface Diagram { _id: Id<"diagrams">; name: string }
interface Spreadsheet { _id: Id<"spreadsheets">; name: string }
interface Document { _id: Id<"documents">; name: string }

interface CellRefDialogOpen {
  open: boolean;
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
}

type CellRefDialogState = CellRefDialogOpen | null;

interface BlockPickerDialogOpen {
  open: boolean;
  documentId: Id<"documents">;
  documentName: string;
}

type BlockPickerDialogState = BlockPickerDialogOpen | null;

/**
 * Builds the `#`-trigger suggestion items (diagrams + spreadsheets + documents)
 * and the CellRefDialog/BlockPickerDialog insert handlers for DocumentEditor.
 */
export function useDocumentSuggestions({
  diagrams,
  spreadsheets,
  documents,
  editor,
  ensureCellRef,
  ensureBlockRef,
  setCellRefDialog,
  setBlockPickerDialog,
  currentDocumentId,
}: {
  diagrams: Diagram[] | undefined;
  spreadsheets: Spreadsheet[] | undefined;
  documents: Document[] | undefined;
  editor: DocumentSchemaEditor | null;
  ensureCellRef: (args: { spreadsheetId: Id<"spreadsheets">; cellRef: string }) => Promise<null>;
  ensureBlockRef: (args: { documentId: Id<"documents">; blockId: string }) => Promise<null>;
  setCellRefDialog: (state: CellRefDialogState) => void;
  setBlockPickerDialog: (state: BlockPickerDialogState) => void;
  currentDocumentId?: Id<"documents">;
}) {
  // getHashItems is called on every keystroke — no need for referential stability
  const getHashItems = async (query: string) => {
    const diagramItems = (diagrams ?? []).map((diagram) => ({
      title: diagram.name,
      onItemClick: () => {
        if (!editor) return;
        editor.insertBlocks(
          [
            {
              type: "diagram" as const,
              props: { diagramId: diagram._id } as any,
            },
          ],
          editor.getTextCursorPosition().block,
          "after",
        );
      },
      icon: createElement(PenTool, { className: "h-4 w-4" }),
      group: "Workspace diagrams",
    }));

    const spreadsheetItems = (spreadsheets ?? []).map((sheet) => ({
      title: sheet.name,
      onItemClick: () => {
        setCellRefDialog({
          open: true,
          spreadsheetId: sheet._id,
          spreadsheetName: sheet.name,
        });
      },
      icon: createElement(Table, { className: "h-4 w-4" }),
      group: "Spreadsheets",
    }));

    // Exclude the current document from the list (can't embed blocks from yourself)
    const documentItems = (documents ?? [])
      .filter((doc) => doc._id !== currentDocumentId)
      .map((doc) => ({
        title: doc.name,
        onItemClick: () => {
          setBlockPickerDialog({
            open: true,
            documentId: doc._id,
            documentName: doc.name,
          });
        },
        icon: createElement(FileText, { className: "h-4 w-4" }),
        group: "Documents",
      }));

    return [...diagramItems, ...spreadsheetItems, ...documentItems].filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase()),
    );
  };

  const handleCellRefInsert = (cellRef: string | null, cellRefDialog: CellRefDialogOpen) => {
    if (!editor) return;

    const { spreadsheetId } = cellRefDialog;
    editor.focus();

    if (cellRef) {
      if (isSingleCell(cellRef)) {
        editor.insertInlineContent([
          {
            type: "spreadsheetCellRef",
            props: { spreadsheetId, cellRef },
          },
          " ",
        ]);
      } else {
        editor.insertBlocks(
          [
            {
              type: "spreadsheetRange" as const,
              props: { spreadsheetId, cellRef } as any,
            },
          ],
          editor.getTextCursorPosition().block,
          "after",
        );
      }
      void ensureCellRef({ spreadsheetId, cellRef });
    } else {
      editor.insertInlineContent([
        {
          type: "spreadsheetLink",
          props: { spreadsheetId },
        },
        " ",
      ]);
    }
    setCellRefDialog(null);
  };

  const handleBlockPickerInsert = (blockId: string, blockPickerDialog: BlockPickerDialogOpen) => {
    if (!editor) return;

    const { documentId } = blockPickerDialog;
    editor.focus();

    editor.insertBlocks(
      [
        {
          type: "documentBlockEmbed" as const,
          props: { documentId, blockId } as any,
        },
      ],
      editor.getTextCursorPosition().block,
      "after",
    );

    void ensureBlockRef({ documentId, blockId });
    setBlockPickerDialog(null);
  };

  return { getHashItems, handleCellRefInsert, handleBlockPickerInsert };
}
