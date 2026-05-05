import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useJSpreadsheetInstance } from "@/hooks/use-jspreadsheet-instance";
import { useSpreadsheetCollaboration } from "@/hooks/use-spreadsheet-collaboration";
import { useViewer } from "../UserContext";
import { exceedsMaxCells, toCellName } from "@ripple/shared/cellRef";
import type { Id } from "@convex/_generated/dataModel";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";

interface SpreadsheetCellPickerProps {
  open: boolean;
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  /** Called with the picked A1 string (e.g. "B2" or "B2:D5") on confirm. */
  onConfirm: (cellRef: string) => void;
  onCancel: () => void;
}

type Rect = { x1: number; y1: number; x2: number; y2: number };

/** Format a selection rect as an A1 string, normalizing endpoint order. */
function rectToA1(rect: Rect): string {
  const startCol = Math.min(rect.x1, rect.x2);
  const startRow = Math.min(rect.y1, rect.y2);
  const endCol = Math.max(rect.x1, rect.x2);
  const endRow = Math.max(rect.y1, rect.y2);
  if (startCol === endCol && startRow === endRow) {
    return toCellName(startCol, startRow);
  }
  return `${toCellName(startCol, startRow)}:${toCellName(endCol, endRow)}`;
}

export function SpreadsheetCellPicker({
  open,
  spreadsheetId,
  spreadsheetName,
  onConfirm,
  onCancel,
}: SpreadsheetCellPickerProps) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-none w-[calc(100vw-2rem)] h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] p-0 gap-0 overflow-hidden grid grid-rows-[auto_1fr]"
      >
        {/* Visually hidden but required for a11y */}
        <DialogTitle className="sr-only">
          Select cells from {spreadsheetName}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Click a cell or drag to select a range, then confirm to insert it
          into the document.
        </DialogDescription>
        <PickerBody
          spreadsheetId={spreadsheetId}
          spreadsheetName={spreadsheetName}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  spreadsheetId,
  spreadsheetName,
  onConfirm,
  onCancel,
}: {
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  onConfirm: (cellRef: string) => void;
  onCancel: () => void;
}) {
  const viewer = useViewer();
  const [selection, setSelection] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    yDoc,
    awareness,
    isLoading,
  } = useSpreadsheetCollaboration({
    spreadsheetId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
  });

  const a1 = selection ? rectToA1(selection) : null;
  const sizeError = a1 && exceedsMaxCells(a1)
    ? "Range too large. Maximum 100 cells (e.g., 10×10)."
    : null;
  const displayedError = error ?? sizeError;
  const canConfirm = !!a1 && !sizeError;

  const handleConfirm = () => {
    if (!a1) return;
    if (sizeError) {
      setError(sizeError);
      return;
    }
    onConfirm(a1);
  };

  // Esc closes the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter" && canConfirm) {
        // Allow Enter to confirm when focus isn't inside an editable field
        // (jspreadsheet uses Enter for cell navigation; with editable=false
        // this is harmless — but only act if the grid isn't focused).
        const active = document.activeElement;
        if (!active || active === document.body) {
          e.preventDefault();
          handleConfirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleConfirm intentionally not memoized — it's cheap and React Compiler
    // handles re-creation; we just want the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm, onCancel]);

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h2 className="truncate text-sm font-medium">
            Select cells from <span className="text-muted-foreground">{spreadsheetName}</span>
          </h2>
          <div className="flex h-7 min-w-24 items-center rounded-md border bg-muted/40 px-2 font-mono text-xs">
            {a1 ?? (
              <span className="text-muted-foreground">Click a cell or drag a range</span>
            )}
          </div>
          {displayedError && (
            <p className="truncate text-xs text-destructive">{displayedError}</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={!canConfirm}>
          Confirm
        </Button>
      </div>
      <div className="relative min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading spreadsheet…
          </div>
        ) : (
          <PickerGrid
            yDoc={yDoc}
            awareness={awareness}
            onSelectionChange={(rect) => {
              // Ignore `null` events: jspreadsheet emits them on grid blur
              // (e.g. when the user clicks our Confirm button), which would
              // otherwise race the click and wipe the picked range before
              // handleConfirm reads it. The selection stays put until the
              // user picks a new cell or range — same as Excel's behavior.
              if (rect === null) return;
              setError(null);
              setSelection(rect);
            }}
          />
        )}
      </div>
    </>
  );
}

function PickerGrid({
  yDoc,
  awareness,
  onSelectionChange,
}: {
  yDoc: Parameters<typeof useJSpreadsheetInstance>[0]["yDoc"];
  awareness: Parameters<typeof useJSpreadsheetInstance>[0]["awareness"];
  onSelectionChange: (rect: Rect | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useJSpreadsheetInstance({
    wrapperRef,
    yDoc,
    awareness,
    editable: false,
    // Picker doesn't engage formula picker / edition tracking. Pass no-ops.
    onEditionStart: () => {},
    onEditionEnd: () => {},
    onSelectionChange,
  });

  return <div ref={wrapperRef} className="h-full w-full overflow-auto" />;
}
