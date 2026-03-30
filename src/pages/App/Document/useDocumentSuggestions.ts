import { isSingleCell } from "@shared/cellRef";
import { FileText, PenTool, Table } from "lucide-react";
import { createElement } from "react";
import { Id } from "../../../../convex/_generated/dataModel";
import type { DocumentSchemaEditor } from "./schema";

interface NodeResult {
  resourceId: string;
  resourceType: string;
  name: string;
  tags: string[];
}

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

const RESOURCE_CONFIG = {
  diagram: { icon: PenTool, group: "Workspace diagrams" },
  spreadsheet: { icon: Table, group: "Spreadsheets" },
  document: { icon: FileText, group: "Documents" },
} as const;

/**
 * Builds the `#`-trigger suggestion items (diagrams + spreadsheets + documents)
 * and the CellRefDialog/BlockPickerDialog insert handlers for DocumentEditor.
 *
 * `onSearchChange` is called on every keystroke to drive the debounced query
 * in the parent component. Results are server-filtered; the menu shows a
 * stale visual state while the debounced query catches up.
 */
export function useDocumentSuggestions({
  nodes,
  editor,
  ensureCellRef,
  ensureBlockRef,
  setCellRefDialog,
  setBlockPickerDialog,
  onSearchChange,
  currentDocumentId,
}: {
  nodes: NodeResult[] | undefined;
  editor: DocumentSchemaEditor | null;
  ensureCellRef: (args: { spreadsheetId: Id<"spreadsheets">; cellRef: string }) => Promise<null>;
  ensureBlockRef: (args: { documentId: Id<"documents">; blockId: string }) => Promise<null>;
  setCellRefDialog: (state: CellRefDialogState) => void;
  setBlockPickerDialog: (state: BlockPickerDialogState) => void;
  onSearchChange: (query: string) => void;
  currentDocumentId?: Id<"documents">;
}) {
  const getHashItems = async (query: string) => {
    onSearchChange(query);

    return (nodes ?? [])
      .filter((node) => {
        if (!(node.resourceType in RESOURCE_CONFIG)) return false;
        if (node.resourceType === "document" && node.resourceId === currentDocumentId) return false;
        return true;
      })
      .map((node) => {
        const config = RESOURCE_CONFIG[node.resourceType as keyof typeof RESOURCE_CONFIG];
        return {
          title: node.name,
          onItemClick: () => {
            if (!editor) return;
            if (node.resourceType === "diagram") {
              editor.insertBlocks(
                [
                  {
                    type: "diagram" as const,
                    props: { diagramId: node.resourceId as Id<"diagrams"> } as any,
                  },
                ],
                editor.getTextCursorPosition().block,
                "after",
              );
            } else if (node.resourceType === "spreadsheet") {
              setCellRefDialog({
                open: true,
                spreadsheetId: node.resourceId as Id<"spreadsheets">,
                spreadsheetName: node.name,
              });
            } else if (node.resourceType === "document") {
              setBlockPickerDialog({
                open: true,
                documentId: node.resourceId as Id<"documents">,
                documentName: node.name,
              });
            }
          },
          icon: createElement(config.icon, { className: "h-4 w-4" }),
          group: config.group,
        };
      });
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
