import { isSingleCell } from "@shared/cellRef";
import { PenTool, Table } from "lucide-react";
import { useCallback, createElement } from "react";
import { Id } from "../../../../convex/_generated/dataModel";

type Diagram = { _id: Id<"diagrams">; name: string };
type Spreadsheet = { _id: Id<"spreadsheets">; name: string };

type CellRefDialogState = {
  open: boolean;
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
} | null;

// BlockNote editors use complex generics that don't simplify well.
type Editor = any;

/**
 * Builds the `#`-trigger suggestion items (diagrams + spreadsheets) and the
 * CellRefDialog insert handler for DocumentEditor.
 */
export function useDocumentSuggestions({
  diagrams,
  spreadsheets,
  editor,
  ensureCellRef,
  setCellRefDialog,
}: {
  diagrams: Diagram[] | undefined;
  spreadsheets: Spreadsheet[] | undefined;
  editor: Editor;
  ensureCellRef: (args: { spreadsheetId: Id<"spreadsheets">; cellRef: string }) => Promise<null>;
  setCellRefDialog: (state: CellRefDialogState) => void;
}) {
  // getHashItems is called on every keystroke — no need for referential stability
  const getHashItems = async (query: string) => {
    const diagramItems = (diagrams ?? []).map((diagram) => ({
      title: diagram.name,
      onItemClick: () => {
        editor.insertBlocks(
          [
            {
              type: "diagram" as const,
              props: { diagramId: diagram._id } as Record<string, unknown>,
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

    return [...diagramItems, ...spreadsheetItems].filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase()),
    );
  };

  const handleCellRefInsert = useCallback(
    (cellRef: string | null, cellRefDialog: NonNullable<CellRefDialogState>) => {
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
                props: { spreadsheetId, cellRef } as Record<string, unknown>,
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
    },
    [editor, ensureCellRef, setCellRefDialog],
  );

  return { getHashItems, handleCellRefInsert };
}
