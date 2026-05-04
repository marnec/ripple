import { defaultProps, type BlockConfig } from "@blocknote/core";
import {
  createReactBlockSpec,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { useSpreadsheetCellPreview } from "@/hooks/use-spreadsheet-cell-preview";
import { Button } from "@/components/ui/button";
import { RepointCellRefDialog } from "@/pages/App/Document/RepointCellRefDialog";
import { parseRange } from "@ripple/shared/cellRef";
import { useQuery } from "convex-helpers/react/cache";
import { AlertCircle, CircleSlash } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useBlockResize } from "./useBlockResize";
import { SpreadsheetRangeToolbar } from "./SpreadsheetRangeToolbar";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { buildTableContent } from "./spreadsheetRangeActions";

// ---------------------------------------------------------------------------
// Prop schema
// ---------------------------------------------------------------------------

const spreadsheetRangePropSchema = {
  textAlignment: defaultProps.textAlignment,
  spreadsheetId: { default: "" as unknown as string },
  cellRef: { default: "" },
  stableRef: { default: "" },
  width: { default: 512 },
  showHeaders: { default: true as unknown as boolean },
} as const;

type SpreadsheetRangeProps = ReactCustomBlockRenderProps<
  BlockConfig<"spreadsheetRange", typeof spreadsheetRangePropSchema, "none">
>;

// ---------------------------------------------------------------------------
// Resize handle style (stable reference — no per-render allocation)
// ---------------------------------------------------------------------------

const RESIZE_HANDLE_STYLE: React.CSSProperties = {
  position: "absolute",
  width: "8px",
  height: "40px",
  backgroundColor: "black",
  borderRadius: "4px",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "white",
  zIndex: 10,
};

// ---------------------------------------------------------------------------
// ResizableSpreadsheetRange
// ---------------------------------------------------------------------------

const ResizableSpreadsheetRange = ({
  block,
  editor,
}: SpreadsheetRangeProps) => {
  const { spreadsheetId, cellRef, stableRef, showHeaders } = block.props;

  // --- Data fetching ---
  const spreadsheet = useQuery(
    api.spreadsheets.get,
    spreadsheetId ? { id: spreadsheetId as Id<"spreadsheets"> } : "skip",
  );
  const { values: localValues, isLoading: localLoading, orphan, liveCellRef } =
    useSpreadsheetCellPreview(
      spreadsheetId as Id<"spreadsheets">,
      stableRef ?? "",
    );

  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  // --- Resize ---
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { startResize, isResizingRef } = useBlockResize({
    wrapperRef,
    editor,
    block,
  });

  const [hovered, setHovered] = useState(false);
  const [repointOpen, setRepointOpen] = useState(false);

  // --- Derived data ---
  // Grid renders the LIVE range so insertions inside the range surface as a
  // hole at the right column and the headers track shifts. The label tracks
  // the same live range — the grid and the caption stay in agreement.
  const liveRange = liveCellRef ? parseRange(liveCellRef) : null;
  const originalRange = parseRange(cellRef);
  const renderRange = liveRange ?? originalRange;
  const colCount = renderRange ? renderRange.endCol - renderRange.startCol + 1 : 0;
  const rowCount = renderRange ? renderRange.endRow - renderRange.startRow + 1 : 0;
  const values: string[][] = localValues ?? [];
  const captionCellRef = liveCellRef ?? cellRef;

  // --- Actions ---
  const toggleHeaders = () => {
    editor.updateBlock(block, {
      props: { showHeaders: !showHeaders },
    });
  };

  const cloneAsTable = () => {
    if (!renderRange) return;
    const content = buildTableContent({
      values,
      rowCount,
      colCount,
      startCol: renderRange.startCol,
      startRow: renderRange.startRow,
      showHeaders,
    });
    // Defer to macrotask to avoid synchronous update loop inside BlockNote's table plugin
    setTimeout(() => {
      editor.insertBlocks(
        [{ type: "table" as const, content } as any],
        block,
        "after",
      );
    }, 0);
  };

  const cloneAsLinkedRange = () => {
    editor.insertBlocks(
      [{ type: "spreadsheetRange" as const, props: { spreadsheetId, cellRef, width: block.props.width, showHeaders } } as any],
      block,
      "after",
    );
  };

  const handleNavigate = () => {
    if (spreadsheet && workspaceId) {
      void navigate(
        `/workspaces/${workspaceId}/spreadsheets/${spreadsheetId}`,
      );
    }
  };

  // --- Render states ---

  if (!spreadsheetId || !cellRef) {
    return (
      <div className="p-3 border rounded-lg text-center text-muted-foreground">
        <p>Please select a spreadsheet range to display.</p>
      </div>
    );
  }

  if (spreadsheet === null) {
    return (
      <div data-embed-deleted className="w-full flex flex-col items-center justify-center p-3 border rounded-lg text-center text-muted-foreground bg-secondary h-28 gap-2">
        <CircleSlash className="h-8 w-8 text-destructive" />
        <p className="text-destructive text-sm">
          Spreadsheet not found. It may have been deleted.
        </p>
      </div>
    );
  }

  if (orphan) {
    return (
      <>
        <div className="w-full flex flex-col items-center justify-center p-3 border border-amber-500 rounded-lg text-center bg-amber-50 dark:bg-amber-950/40 gap-2 py-4 animate-fade-in">
          <AlertCircle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200 text-sm">
            #REF! — the row or column for this range was deleted in {spreadsheet?.name ?? "the spreadsheet"}.
          </p>
          {editor.isEditable && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRepointOpen(true)}
            >
              Repoint range
            </Button>
          )}
        </div>
        {repointOpen && (
          <RepointCellRefDialog
            open={repointOpen}
            onOpenChange={setRepointOpen}
            spreadsheetId={spreadsheetId as Id<"spreadsheets">}
            spreadsheetName={spreadsheet?.name ?? ""}
            mode="range"
            initialCellRef={cellRef}
            onRepoint={(nextCellRef, nextStableRef) => {
              editor.updateBlock(block, {
                props: {
                  cellRef: nextCellRef,
                  stableRef: nextStableRef ?? "",
                },
              });
            }}
          />
        )}
      </>
    );
  }

  const isLoading =
    spreadsheet === undefined || (localLoading && !localValues);

  if (isLoading) {
    return (
      <div aria-hidden="true" className="invisible" style={{ width: block.props.width, maxWidth: "100%" }}>
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex-1" />
          <span className="text-xs">&nbsp;</span>
        </div>
        <SpreadsheetGrid
          values={[]}
          colCount={colCount}
          rowCount={rowCount}
          startCol={renderRange?.startCol ?? 0}
          startRow={renderRange?.startRow ?? 0}
          showHeaders={showHeaders}
        />
      </div>
    );
  }

  const caption = `${spreadsheet.name} \u203A ${captionCellRef}`;
  const editable = editor.isEditable;

  return (
    <div
      ref={wrapperRef}
      className="relative group/range animate-fade-in"
      style={{ width: block.props.width, maxWidth: "100%" }}
      onMouseEnter={() => editable && setHovered(true)}
      onMouseLeave={(e) => {
        if (
          (e.relatedTarget as HTMLElement)?.classList?.contains(
            "bn-resize-handle",
          ) ||
          isResizingRef.current
        ) {
          return;
        }
        setHovered(false);
      }}
    >
      {/* Caption bar */}
      <div className="flex items-center justify-between mb-0.5">
        {editable && hovered && (
          <SpreadsheetRangeToolbar
            showHeaders={showHeaders}
            onToggleHeaders={toggleHeaders}
            onCloneAsTable={cloneAsTable}
            onCloneAsLinkedRange={cloneAsLinkedRange}
          />
        )}
        <div className="flex-1" />
        <span
          className="text-xs text-muted-foreground cursor-pointer hover:underline truncate max-w-[60%]"
          onClick={handleNavigate}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleNavigate();
            }
          }}
        >
          {caption}
        </span>
      </div>

      {/* Grid — uses divs instead of <table> to avoid BlockNote's TableHandles plugin */}
      <SpreadsheetGrid
        values={values}
        colCount={colCount}
        rowCount={rowCount}
        startCol={renderRange?.startCol ?? 0}
        startRow={renderRange?.startRow ?? 0}
        showHeaders={showHeaders}
      />

      {/* Click overlay for navigation (non-editable mode) */}
      {!editable && (
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={handleNavigate}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleNavigate();
            }
          }}
        />
      )}

      {/* Block resize handles */}
      {hovered && (
        <>
          <div
            className="bn-resize-handle"
            role="separator"
            style={{
              ...RESIZE_HANDLE_STYLE,
              top: "50%",
              left: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => startResize(e, "l")}
          />
          <div
            className="bn-resize-handle"
            role="separator"
            style={{
              ...RESIZE_HANDLE_STYLE,
              top: "50%",
              right: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => startResize(e, "r")}
          />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Block spec export
// ---------------------------------------------------------------------------

export const SpreadsheetRangeBlock = createReactBlockSpec(
  {
    type: "spreadsheetRange" as const,
    propSchema: spreadsheetRangePropSchema,
    content: "none" as const,
  },
  {
    render: (props) => <ResizableSpreadsheetRange {...props} />,
  },
);
