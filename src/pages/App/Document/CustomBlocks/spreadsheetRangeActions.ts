import { toCellName } from "@shared/cellRef";

function colLetter(col: number): string {
  return toCellName(col, 0).replace(/\d+$/, "");
}

type TextCell = { type: "text"; text: string; styles: object };

function textCell(text: string): TextCell[] {
  return [{ type: "text" as const, text, styles: {} }];
}

interface BuildTableContentArgs {
  values: string[][];
  rowCount: number;
  colCount: number;
  startCol: number;
  startRow: number;
  showHeaders: boolean;
}

/**
 * Builds a BlockNote table content structure from spreadsheet range data.
 */
export function buildTableContent({
  values,
  rowCount,
  colCount,
  startCol,
  startRow,
  showHeaders,
}: BuildTableContentArgs) {
  const tableRows: { cells: TextCell[][] }[] = [];

  if (showHeaders) {
    const headerCells = [
      textCell(""),
      ...Array.from({ length: colCount }, (_, ci) =>
        textCell(colLetter(startCol + ci)),
      ),
    ];
    tableRows.push({ cells: headerCells });
  }

  for (let ri = 0; ri < rowCount; ri++) {
    const dataCells = [
      ...(showHeaders ? [textCell(String(startRow + ri + 1))] : []),
      ...Array.from({ length: colCount }, (_, ci) =>
        textCell(values[ri]?.[ci] || ""),
      ),
    ];
    tableRows.push({ cells: dataCells });
  }

  const totalCols = colCount + (showHeaders ? 1 : 0);

  return {
    type: "tableContent" as const,
    columnWidths: Array.from({ length: totalCols }, () => undefined),
    ...(showHeaders ? { headerRows: 1, headerCols: 1 } : {}),
    rows: tableRows,
  };
}
