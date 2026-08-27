import { useResourceDoc } from "@/hooks/use-collab-session";
import { CellRefDialog } from "@/pages/App/Document/CellRefDialog";
import { readRangeValues } from "@/lib/spreadsheet-range-read";
import type { Id } from "@convex/_generated/dataModel";

export interface SpreadsheetRangePick {
  /** Normalised A1, or null when the sender left the field blank (chip only). */
  cellRef: string | null;
  /** Frozen display values for `cellRef`; null for the chip-only pick. */
  values: string[][] | null;
}

interface SpreadsheetRangeDialogProps {
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  onPick: (pick: SpreadsheetRangePick) => void;
  onClose: () => void;
}

/**
 * The chat side of "reference a spreadsheet": the same `CellRefDialog` a
 * document uses, wrapped in the room the values are read from.
 *
 * A chat range is **frozen** — the message keeps the numbers as they were when
 * it was sent — so the values have to be read at pick time rather than tracked.
 * They are read from the live replica, not from the stored snapshot, so that
 * what the sender saw in the picker is exactly what the channel gets; a
 * snapshot can lag the room by a save interval and would quietly hand them
 * older numbers.
 *
 * Mounted only while the dialog is open, which is what makes the room's cost
 * proportional to actually referencing a sheet. The picker inside opens its own
 * replica of the same room for the seconds it is up; they converge, and paying
 * for that beats drilling a Y.Doc through two components that have no other
 * reason to know about one.
 */
export function SpreadsheetRangeDialog({
  spreadsheetId,
  spreadsheetName,
  onPick,
  onClose,
}: SpreadsheetRangeDialogProps) {
  const { yDoc, isHydrated } = useResourceDoc({
    resourceType: "spreadsheet",
    resourceId: spreadsheetId,
  });

  return (
    <CellRefDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      spreadsheetId={spreadsheetId}
      spreadsheetName={spreadsheetName}
      // Until the replica holds the room's state, a read would return a grid of
      // blanks and say nothing about it — so a range simply can't be confirmed
      // yet. The blank-field "insert as chip" path needs no values and stays
      // available throughout.
      rangeReady={isHydrated}
      onInsert={(cellRef) => {
        onPick({
          cellRef,
          values: cellRef ? readRangeValues(yDoc, cellRef) : null,
        });
        onClose();
      }}
    />
  );
}
