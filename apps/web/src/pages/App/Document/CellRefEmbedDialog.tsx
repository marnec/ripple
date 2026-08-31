import { useResourceDoc } from "@/hooks/use-collab-session";
import { isBlankGrid } from "@ripple/shared/cellValues";
import { readGridRange, stableRefForCell } from "@ripple/shared/spreadsheetDoc";
import type { CellRefEmbedPick } from "@/lib/embed-insert";
import { CellRefDialog } from "./CellRefDialog";
import type { Id } from "@convex/_generated/dataModel";

interface CellRefEmbedDialogProps {
  spreadsheetId: Id<"spreadsheets">;
  spreadsheetName: string;
  onPick: (pick: CellRefEmbedPick) => void;
  onClose: () => void;
}

/**
 * "Reference a cell from this spreadsheet", wrapped in the room the answer
 * comes from — the document-embed sibling of chat's `SpreadsheetRangeDialog`.
 *
 * Both the stable identity of the picked cell and the values to show for it
 * are already in the replica the picker just rendered, so both are read here
 * rather than asked for. That turns inserting a reference from "wait for an
 * action that downloads the whole snapshot, then insert" into an insert that
 * happens on the click, with content in it.
 *
 * A document embed *tracks* its cell, unlike a chat range, which freezes it —
 * the values read here are a starting picture, not the reference itself.
 */
export function CellRefEmbedDialog({
  spreadsheetId,
  spreadsheetName,
  onPick,
  onClose,
}: CellRefEmbedDialogProps) {
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
      // An unhydrated replica reads as a grid of blanks without saying so, so
      // a cell can't be confirmed against it yet. Inserting the spreadsheet as
      // a plain link needs nothing from the room and stays available.
      rangeReady={isHydrated}
      // An embed tracks its cells, so an empty range is a legitimate thing to
      // want — you can reference cells you are about to fill in. It is also
      // the shape of a mistake (an off-by-one row, the wrong sheet), and the
      // block gives no hint either way once inserted: a blank grid looks the
      // same as one that is still loading. So: say it, don't prevent it.
      rangeWarning={(cellRef) => {
        const values = readGridRange(yDoc, cellRef);
        return values && isBlankGrid(values)
          ? `${cellRef} is empty — the embed stays blank until those cells have values.`
          : null;
      }}
      onInsert={(cellRef) => {
        onPick(
          cellRef
            ? {
                cellRef,
                stableRef: stableRefForCell(yDoc, cellRef),
                values: readGridRange(yDoc, cellRef),
              }
            : { cellRef: null, stableRef: null, values: null },
        );
        onClose();
      }}
    />
  );
}
