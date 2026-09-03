import { Plus } from "lucide-react";
import { Button } from "@ripple/ui/components/button";

/**
 * How much one click adds. The seeded grid is deliberately small
 * (`collab/empty-grid.ts`), so these are the steps that make it usable without
 * putting the cost back: roughly half a screen of rows, a handful of columns.
 */
export const ROW_STEP = 20;
export const COL_STEP = 5;

/**
 * The strip under the grid: grow the sheet at its ends.
 *
 * Appending is the one structural edit with no context — right-clicking asks
 * "insert relative to *this* row", which is the wrong question when what you
 * want is more sheet. It is also the only one that shifts nothing, so it needs
 * no confirmation and no selection to act on.
 */
export function SpreadsheetExtendBar({
  onAddRows,
  onAddColumns,
}: {
  onAddRows: (count: number) => void;
  onAddColumns: (count: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 py-1">
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => onAddRows(ROW_STEP)}
      >
        <Plus />
        {ROW_STEP} rows
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => onAddColumns(COL_STEP)}
      >
        <Plus />
        {COL_STEP} columns
      </Button>
    </div>
  );
}
