import { ResourceReferenceChip } from "./ResourceReferenceChip";
import { hasHeaderRow, isNumericCell } from "@/lib/spreadsheet-snapshot";
import { cn } from "@/lib/utils";

interface SpreadsheetRangeSnapshotProps {
  spreadsheetId: string;
  /** Name recorded when the message was sent; the chip resolves the live one. */
  spreadsheetName?: string;
  /** A1 for the cells below, as they were trimmed at send time. */
  cellRef: string;
  /** Frozen display text, row-major. Never empty (the caller checks). */
  rows: string[][];
}

/** Past this the grid scrolls inside the panel instead of stretching the wall. */
const MAX_GRID_HEIGHT = "16rem";

/**
 * A frozen spreadsheet range, drawn as one object inside the message bubble.
 *
 * Until now the two halves of a chat range were two unrelated blocks — a
 * reference chip in a paragraph, then a plain BlockNote table styled like any
 * table a person might have typed. Nothing said the table came from the sheet
 * named a line above, the columns stretched to whatever width the bubble
 * allowed, and blank cells drew a grid of empty boxes.
 *
 * So the pair is drawn as a panel: the chip becomes its header (still the link
 * to the live spreadsheet, still resolving the current name), the cells sit
 * under it in a frame only as wide as the data, numbers are right-aligned on
 * tabular figures, and a long range scrolls in place rather than pushing the
 * conversation down.
 *
 * **Every surface here is an alpha of `foreground`, never an opaque token.**
 * The panel has to sit inside two differently-coloured bubbles — the sender's
 * own tinted one and the plain muted one — in both themes, and an opaque card
 * reads as a foreign object dropped on top of the bubble. Tinting instead means
 * the panel takes the bubble's own colour and shifts it: darker on the light
 * themes, lighter on the dark ones, which is the direction each one expects.
 *
 * The stored body is unchanged — still a chip plus an ordinary `table` block.
 * This is a rendering decision, which is what lets it apply to every range
 * already sitting in a channel.
 */
export function SpreadsheetRangeSnapshot({
  spreadsheetId,
  spreadsheetName,
  cellRef,
  rows,
}: SpreadsheetRangeSnapshotProps) {
  const colCount = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  // A range read back can be ragged where trailing cells were never written.
  const grid = rows.map((row) =>
    Array.from({ length: colCount }, (_, c) => row[c] ?? ""),
  );

  // A column that is blank the whole way down is a gap in the data, not a
  // column of values — it keeps its place in the grid but gives up its width.
  const gapColumns = Array.from({ length: colCount }, (_, c) =>
    grid.every((row) => row[c].trim() === ""),
  );

  const headed = hasHeaderRow(grid);
  const head = headed ? grid[0] : null;
  const body = headed ? grid.slice(1) : grid;

  return (
    <figure className="my-1 w-fit max-w-full overflow-hidden rounded-md border border-foreground/15 bg-foreground/5 first:mt-0">
      {/* `px-2.5` matches the cells' padding, so the header's icon starts on
          the same rule as the first column's text. */}
      <figcaption className="flex min-w-0 items-center border-b border-foreground/12 px-2.5 py-1">
        <ResourceReferenceChip
          resourceId={spreadsheetId}
          resourceType="spreadsheet"
          cellRef={cellRef}
          variant="bare"
        />
      </figcaption>

      <div
        className="overflow-auto overscroll-contain"
        style={{ maxHeight: MAX_GRID_HEIGHT }}
      >
        {/*
         * `min-w-full`, not `w-auto`: the header names the sheet and the range,
         * so it is regularly the widest thing in the panel, and a grid sized to
         * its own content then stopped short of the right edge with the row
         * rules ending in mid-air. The columns absorb the slack instead, which
         * is what a sheet does anyway. A grid wider than the panel still grows
         * past this and scrolls.
         */}
        <table className="min-w-full border-collapse text-[13px] leading-tight">
          <caption className="sr-only">
            {spreadsheetName ? `${spreadsheetName}, cells ${cellRef}` : `Cells ${cellRef}`}
          </caption>

          {head && (
            <thead>
              <tr>
                {head.map((cell, ci) => (
                  <th
                    key={ci}
                    scope="col"
                    className={cn(
                      cellClass(ci, gapColumns[ci]),
                      // Sticky over a translucent panel would show the rows
                      // sliding under it, so the header row is the one surface
                      // that closes: the panel tint plus the bubble behind it.
                      "sticky top-0 z-1 border-b border-foreground/12 bg-foreground/6 font-medium backdrop-blur-sm",
                    )}
                  >
                    <Cell text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          )}

          <tbody className="divide-y divide-foreground/12">
            {body.map((row, ri) => (
              <tr key={ri} className="transition-colors hover:bg-foreground/4">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      cellClass(ci, gapColumns[ci]),
                      isNumericCell(cell) ? "text-right tabular-nums" : "text-left",
                    )}
                  >
                    <Cell text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/**
 * `min-w` keeps a cell from collapsing to a hairline, `max-w` keeps one long
 * string from making the panel wider than the conversation.
 */
function cellClass(ci: number, isGap: boolean): string {
  return cn(
    "max-w-56 px-2.5 py-1 align-top",
    isGap ? "min-w-4" : "min-w-14",
    ci > 0 && "border-l border-foreground/12",
  );
}

/**
 * A blank cell still needs a line box or the row loses its height, so it gets a
 * non-breaking space rather than nothing.
 */
function Cell({ text }: { text: string }) {
  return (
    <span className="block truncate" title={text.trim() || undefined}>
      {text.trim() === "" ? " " : text}
    </span>
  );
}
