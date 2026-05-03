import React from "react";
import { toCellName } from "@ripple/shared/cellRef";

function colLetter(col: number): string {
  return toCellName(col, 0).replace(/\d+$/, "");
}

interface SpreadsheetGridProps {
  values: string[][];
  colCount: number;
  rowCount: number;
  startCol: number;
  startRow: number;
  showHeaders: boolean;
}

export function SpreadsheetGrid({
  values,
  colCount,
  rowCount,
  startCol,
  startRow,
  showHeaders,
}: SpreadsheetGridProps) {
  return (
    <div
      className="border border-border rounded-lg overflow-x-auto select-none"
      draggable={false}
    >
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: showHeaders
            ? `40px repeat(${colCount}, minmax(0, 1fr))`
            : `repeat(${colCount}, minmax(0, 1fr))`,
        }}
      >
        {showHeaders && (
          <>
            <div className="bg-muted/50 border-b border-r border-border px-1 py-0.5 text-[10px] text-muted-foreground font-normal w-10" />
            {Array.from({ length: colCount }, (_, ci) => (
              <div
                key={ci}
                className="bg-muted/50 border-b border-border px-1 py-0.5 text-[10px] text-muted-foreground font-medium text-center"
              >
                {colLetter(startCol + ci)}
              </div>
            ))}
          </>
        )}

        {Array.from({ length: rowCount }, (_, ri) => (
          <React.Fragment key={ri}>
            {showHeaders && (
              <div className="bg-muted/50 border-r border-border px-1 py-0.5 text-[10px] text-muted-foreground font-normal text-center w-10">
                {startRow + ri + 1}
              </div>
            )}
            {Array.from({ length: colCount }, (_, ci) => (
              <div
                key={ci}
                className={`px-2.5 py-1.5 text-sm font-mono truncate border-border${ci < colCount - 1 ? " border-r" : ""}${ri < rowCount - 1 ? " border-b" : ""}`}
              >
                {values[ri]?.[ci] || "\u00A0"}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
