import { defaultProps } from "@blocknote/core";
import {
  createReactBlockSpec,
  ReactCustomBlockRenderProps,
} from "@blocknote/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSpreadsheetCellPreview } from "@/hooks/use-spreadsheet-cell-preview";
import { parseRange, toCellName } from "@shared/cellRef";
import { useQuery } from "convex/react";
import { CircleSlash, Eye, EyeOff } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Prop schema
// ---------------------------------------------------------------------------

const spreadsheetRangePropSchema = {
  textAlignment: defaultProps.textAlignment,
  spreadsheetId: { default: "" as unknown as string },
  cellRef: { default: "" },
  width: { default: 512 },
  showHeaders: { default: true as unknown as boolean },
} as const;

type SpreadsheetRangeProps = ReactCustomBlockRenderProps<
  "spreadsheetRange",
  typeof spreadsheetRangePropSchema,
  "none"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate column letter for a 0-indexed column number. */
function colLetter(col: number): string {
  return toCellName(col, 0).replace(/\d+$/, "");
}

// ---------------------------------------------------------------------------
// ResizableSpreadsheetRange
// ---------------------------------------------------------------------------

const ResizableSpreadsheetRange = ({
  block,
  editor,
}: SpreadsheetRangeProps) => {
  const { spreadsheetId, cellRef, showHeaders } = block.props;
  const spreadsheet = useQuery(
    api.spreadsheets.get,
    spreadsheetId ? { id: spreadsheetId as Id<"spreadsheets"> } : "skip",
  );
  const { values: localValues, isLoading: localLoading } =
    useSpreadsheetCellPreview(
      spreadsheetId as Id<"spreadsheets">,
      cellRef,
    );

  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  const [hovered, setHovered] = useState(false);

  // Derive column count from data or range
  const range = useMemo(() => parseRange(cellRef), [cellRef]);
  const colCount = range ? range.endCol - range.startCol + 1 : 0;
  const rowCount = range ? range.endRow - range.startRow + 1 : 0;

  const values: string[][] = localValues ?? [];

  const blockResizeDown = (
    e: React.MouseEvent,
    handle: "l" | "r",
  ) => {
    e.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const initialWidth = wrapper.clientWidth;
    const initialClientX = e.clientX;
    const alignment = block.props.textAlignment;

    const onMouseMove = (ev: MouseEvent) => {
      const xDiff = ev.clientX - initialClientX;
      const multiplier = alignment === "center" ? 2 : 1;
      const newWidth =
        handle === "r"
          ? initialWidth + xDiff * multiplier
          : initialWidth - xDiff * multiplier;

      const minWidth = 64;
      const editorWidth = (
        editor.domElement?.firstElementChild as HTMLElement
      )?.clientWidth;
      const finalWidth = Math.min(
        Math.max(newWidth, minWidth),
        editorWidth || Number.MAX_VALUE,
      );
      wrapper.style.width = `${finalWidth}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      isResizingRef.current = false;

      editor.updateBlock(block, {
        props: { width: wrapper.clientWidth },
      });
    };

    isResizingRef.current = true;
    // Capture phase: fires before table container's onMouseMove stopPropagation
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
  };

  // --- Toggle headers ---
  const toggleHeaders = useCallback(() => {
    editor.updateBlock(block, {
      props: { showHeaders: !showHeaders },
    });
  }, [editor, block, showHeaders]);

  // --- Navigation ---
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
      <div className="w-full flex flex-col items-center justify-center p-3 border rounded-lg text-center text-muted-foreground bg-secondary h-28 gap-2">
        <CircleSlash className="h-8 w-8 text-destructive" />
        <p className="text-destructive text-sm">
          Spreadsheet not found. It may have been deleted.
        </p>
      </div>
    );
  }

  const isLoading =
    spreadsheet === undefined || (localLoading && !localValues);

  if (isLoading) {
    return (
      <div
        className="animate-pulse bg-muted/40 rounded-lg border border-border"
        style={{ width: block.props.width, height: 100 }}
      />
    );
  }

  const caption = `${spreadsheet.name} \u203A ${cellRef}`;
  const editable = editor.isEditable;

  const resizeHandleStyle: React.CSSProperties = {
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

  return (
    <div
      ref={wrapperRef}
      className="relative group/range"
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
      {/* Caption */}
      <div className="flex items-center justify-between mb-0.5">
        {/* Header toggle */}
        {editable && hovered && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex p-0.5 items-center justify-center cursor-pointer rounded hover:bg-muted transition-colors text-muted-foreground"
                  onClick={toggleHeaders}
                >
                  {showHeaders ? (
                    <Eye size={12} />
                  ) : (
                    <EyeOff size={12} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="text-xs">
                  {showHeaders ? "Hide" : "Show"} row/column headers
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div className="flex-1" />
        <span
          className="text-xs text-muted-foreground cursor-pointer hover:underline truncate max-w-[60%]"
          onClick={handleNavigate}
        >
          {caption}
        </span>
      </div>

      {/* Table — stop mousemove from reaching BlockNote's table column-resize plugin */}
      <div
        className="border border-border rounded-lg overflow-x-auto"
        onMouseMove={(e) => e.stopPropagation()}
      >
        <table
          className="border-collapse w-full table-fixed select-none"
          draggable={false}
        >
          <colgroup>
            {showHeaders && (
              <col style={{ width: 40 }} />
            )}
            {Array.from({ length: colCount }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>

          {showHeaders && range && (
            <thead>
              <tr>
                <th className="bg-muted/50 border-b border-r border-border px-1 py-0.5 text-[10px] text-muted-foreground font-normal w-10" />
                {Array.from({ length: colCount }, (_, ci) => (
                  <th
                    key={ci}
                    className="relative bg-muted/50 border-b border-border px-1 py-0.5 text-[10px] text-muted-foreground font-medium text-center select-none"
                  >
                    {colLetter(range.startCol + ci)}
                  </th>
                ))}
              </tr>
            </thead>
          )}

          <tbody>
            {Array.from({ length: rowCount }, (_, ri) => (
              <tr key={ri}>
                {showHeaders && range && (
                  <td className="bg-muted/50 border-r border-border px-1 py-0.5 text-[10px] text-muted-foreground font-normal text-center select-none w-10">
                    {range.startRow + ri + 1}
                  </td>
                )}
                {Array.from({ length: colCount }, (_, ci) => (
                  <td
                    key={ci}
                    className="border-b border-r border-border last:border-r-0 px-2.5 py-1.5 text-sm font-mono truncate"
                  >
                    {values[ri]?.[ci] || "\u00A0"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Click overlay for navigation (non-editable mode) */}
      {!editable && (
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={handleNavigate}
        />
      )}

      {/* Block resize handles */}
      {hovered && (
        <>
          <div
            className="bn-resize-handle"
            style={{
              ...resizeHandleStyle,
              top: "50%",
              left: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => blockResizeDown(e, "l")}
          />
          <div
            className="bn-resize-handle"
            style={{
              ...resizeHandleStyle,
              top: "50%",
              right: 4,
              cursor: "ew-resize",
              transform: "translateY(-50%)",
            }}
            onMouseDown={(e) => blockResizeDown(e, "r")}
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
