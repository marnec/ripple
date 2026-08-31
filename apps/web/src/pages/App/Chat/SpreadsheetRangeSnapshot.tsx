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

/** Past this the grid scrolls inside the card instead of stretching the wall. */
const MAX_GRID_HEIGHT = "16rem";

/**
 * A frozen spreadsheet range, drawn as one object.
 *
 * Until now the two halves of a chat range were two unrelated blocks — a
 * reference chip in a paragraph, then a plain BlockNote table under it, styled
 * like any table a person might have typed. Nothing said the table came from
 * the sheet named a line above, the columns stretched to whatever width the
 * bubble allowed, and blank cells drew a grid of empty boxes.
 *
 * So the pair is drawn as a sheet: the chip becomes the card's header (still
 * the link to the live spreadsheet, still resolving the current name), the
 * cells sit under it in a frame that is only as wide as the data, numbers are
 * right-aligned on tabular figures, and a long range scrolls in place rather
 * than pushing the conversation down.
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
  const headed = hasHeaderRow(rows);
  const head = headed ? rows[0] : null;
  const body = headed ? rows.slice(1) : rows;

  return (
    <figure className="my-1.5 w-fit max-w-full overflow-hidden rounded-md border border-border/70 bg-background">
      <figcaption className="flex items-center border-b border-border/70 bg-muted/50 px-1.5 py-1">
        <ResourceReferenceChip
          resourceId={spreadsheetId}
          resourceType="spreadsheet"
          cellRef={cellRef}
        />
      </figcaption>

      <div
        className="overflow-auto overscroll-contain"
        style={{ maxHeight: MAX_GRID_HEIGHT }}
      >
        <table className="w-auto border-collapse text-[13px] leading-tight">
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
                      CELL,
                      "sticky top-0 z-1 bg-muted/70 font-medium text-foreground",
                      ci > 0 && "border-l border-border/60",
                    )}
                  >
                    <Cell text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          )}

          <tbody className="divide-y divide-border/60">
            {body.map((row, ri) => (
              <tr key={ri} className="transition-colors hover:bg-foreground/[0.035]">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      CELL,
                      ci > 0 && "border-l border-border/60",
                      isNumericCell(cell)
                        ? "text-right tabular-nums"
                        : "text-left",
                      cell.trim() === "" && "text-transparent",
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
 * `min-w` keeps a blank cell from collapsing to a hairline, `max-w` keeps one
 * long string from making the card wider than the conversation.
 */
const CELL = "min-w-14 max-w-56 px-2.5 py-1 align-top";

/**
 * A blank cell still needs a line box or the row loses its height, so it gets a
 * non-breaking space that the `text-transparent` on the cell hides.
 */
function Cell({ text }: { text: string }) {
  const shown = text.trim() === "" ? " " : text;
  return (
    <span className="block truncate" title={text.trim() || undefined}>
      {shown}
    </span>
  );
}
