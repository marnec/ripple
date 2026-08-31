import type { BlockPreview } from "@ripple/shared/blockRef";
import { Clock, FileText, PenTool, Search, Table } from "lucide-react";
import { createElement } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { RecentItem } from "@/hooks/use-local-recents";
import { useEmbedInsert } from "@/hooks/use-embed-insert";
import type { CellRefEmbedPick } from "@/lib/embed-insert";
import type { DocumentSchemaEditor } from "./schema";

interface NodeResult {
  resourceId: string;
  resourceType: string;
  name: string;
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

interface FramePickerDialogOpen {
  open: boolean;
  diagramId: Id<"diagrams">;
  diagramName: string;
}

type FramePickerDialogState = FramePickerDialogOpen | null;

const RESOURCE_ICON = {
  diagram: PenTool,
  spreadsheet: Table,
  document: FileText,
} as const;

type EmbeddableType = keyof typeof RESOURCE_ICON;

const EMBEDDABLE_TYPES = new Set<string>(Object.keys(RESOURCE_ICON));

function isEmbeddable(type: string): type is EmbeddableType {
  return EMBEDDABLE_TYPES.has(type);
}

/**
 * Builds the `#`-trigger suggestion items for DocumentEditor.
 *
 * - No search text → shows recent items from localStorage (zero backend queries)
 * - With search text → shows server results from nodes.search
 * - Empty recents → shows a placeholder prompting the user to type
 */
export function useDocumentSuggestions({
  recents,
  searchResults,
  hasSearch,
  isStale,
  editor,
  setCellRefDialog,
  setBlockPickerDialog,
  setFramePickerDialog,
  onSearchChange,
  currentDocumentId,
}: {
  recents: RecentItem[];
  searchResults: NodeResult[] | undefined;
  hasSearch: boolean;
  isStale: boolean;
  editor: DocumentSchemaEditor | null;
  setCellRefDialog: (state: CellRefDialogState) => void;
  setBlockPickerDialog: (state: BlockPickerDialogState) => void;
  setFramePickerDialog: (state: FramePickerDialogState) => void;
  onSearchChange: (query: string) => void;
  currentDocumentId?: Id<"documents">;
}) {
  const { insertCellRef, insertBlock } = useEmbedInsert();
  function makeItem(resourceType: string, resourceId: string, name: string, group: string) {
    const icon = isEmbeddable(resourceType)
      ? RESOURCE_ICON[resourceType]
      : FileText;
    return {
      title: name,
      onItemClick: () => {
        if (!editor) return;
        if (resourceType === "diagram") {
          // Pick which frame to embed (or the whole diagram) before inserting.
          setFramePickerDialog({
            open: true,
            diagramId: resourceId as Id<"diagrams">,
            diagramName: name,
          });
        } else if (resourceType === "spreadsheet") {
          setCellRefDialog({
            open: true,
            spreadsheetId: resourceId as Id<"spreadsheets">,
            spreadsheetName: name,
          });
        } else if (resourceType === "document") {
          setBlockPickerDialog({
            open: true,
            documentId: resourceId as Id<"documents">,
            documentName: name,
          });
        }
      },
      icon: createElement(icon, { className: "h-4 w-4" }),
      group,
    };
  }

  const getHashItems = async (query: string) => {
    onSearchChange(query);

    if (!hasSearch && !query.trim()) {
      // No search text — show embeddable recents.
      const recentItems = recents
        .filter(
          (r) =>
            isEmbeddable(r.resourceType) && r.resourceId !== currentDocumentId,
        )
        .map((r) => makeItem(r.resourceType, r.resourceId, r.resourceName, "Recent"));

      if (recentItems.length > 0) return recentItems;

      // No recents — show placeholder
      return [{
        title: "Type to search resources…",
        onItemClick: () => {},
        icon: createElement(Search, { className: "h-4 w-4" }),
        group: "",
      }];
    }

    // Search mode — show server results (may be stale while debounce catches up)
    if (isStale || !searchResults) {
      // Still waiting for debounced results — show loading hint
      return [{
        title: "Searching…",
        onItemClick: () => {},
        icon: createElement(Clock, { className: "h-4 w-4" }),
        group: "",
      }];
    }

    return searchResults
      .filter((node) => isEmbeddable(node.resourceType) && node.resourceId !== currentDocumentId)
      .map((node) => makeItem(node.resourceType, node.resourceId, node.name, "Results"));
  };

  const handleCellRefInsert = (
    pick: CellRefEmbedPick,
    cellRefDialog: CellRefDialogOpen,
  ) => {
    if (!editor) return;
    insertCellRef(editor, cellRefDialog.spreadsheetId, pick);
    setCellRefDialog(null);
  };

  const handleFramePickerInsert = (
    frameId: string | null,
    framePickerDialog: FramePickerDialogOpen,
  ) => {
    if (!editor) return;
    editor.focus();
    editor.insertBlocks(
      [
        {
          type: "diagram" as const,
          // "" = whole diagram (BlockNote props can't be null).
          props: { diagramId: framePickerDialog.diagramId, frameId: frameId ?? "" },
        },
      ],
      editor.getTextCursorPosition().block,
      "after",
    );
    setFramePickerDialog(null);
  };

  const handleBlockPickerInsert = (
    block: BlockPreview,
    blockPickerDialog: BlockPickerDialogOpen,
  ) => {
    if (!editor) return;
    insertBlock(editor, blockPickerDialog.documentId, block);
    setBlockPickerDialog(null);
  };

  return { getHashItems, handleCellRefInsert, handleBlockPickerInsert, handleFramePickerInsert };
}
