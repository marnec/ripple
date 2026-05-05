import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";

export function exportSpreadsheetCsv(binding: SpreadsheetYjsBinding, name: string): void {
  const worksheet = binding.getWorksheet();
  if (!worksheet?.download) {
    throw new Error("Spreadsheet not ready");
  }
  // jspreadsheet-ce v5: `download(includeHeaders, processed)` produces CSV named
  // after `worksheet.options.worksheetName`. Set it temporarily so the download
  // matches the resource's display name.
  const previousName = worksheet.options?.worksheetName;
  if (worksheet.options) {
    worksheet.options.worksheetName = sanitizeFilename(name);
  }
  try {
    worksheet.download(false);
  } finally {
    if (worksheet.options) {
      worksheet.options.worksheetName = previousName;
    }
  }
}

export async function exportSpreadsheetXlsx(binding: SpreadsheetYjsBinding, name: string): Promise<void> {
  const worksheet = binding.getWorksheet();
  if (!worksheet?.getData) {
    throw new Error("Spreadsheet not ready");
  }
  const XLSX = await import("xlsx");
  // jspreadsheet stores everything as strings — formulas as `=…`. Without
  // type promotion, SheetJS writes them as text cells (Excel shows the
  // leading apostrophe). We convert formulas to formula cells with a cached
  // computed value, and numeric strings to number cells. SheetJS's
  // `aoa_to_sheet` accepts pre-built cell objects mixed with primitives.
  const raw: string[][] = worksheet.getData();
  const aoa: (string | number | XlsxCell | null)[][] = raw.map((row, r) =>
    row.map((cell, c) => coerceCell(cell, r, c, worksheet)),
  );
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  // Force Excel to recompute formulas on open so cached values match
  // jspreadsheet's evaluator (which may differ in subtle precision/locale).
  (book.Workbook as any) = { ...(book.Workbook ?? {}), CalcPr: { fullCalcOnLoad: true } };
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" });
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${sanitizeFilename(name)}.xlsx`,
  );
}

interface XlsxCell {
  t: "n" | "s" | "b";
  v: number | string | boolean;
  f?: string;
}

function coerceCell(value: string, row: number, col: number, worksheet: any): string | number | XlsxCell | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("=")) {
    let computed: unknown = "";
    try {
      computed = worksheet.getValueFromCoords(col, row, true);
    } catch { /* leave empty */ }
    return formulaCell(value.slice(1), computed);
  }
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function formulaCell(formula: string, computed: unknown): XlsxCell {
  if (typeof computed === "number" && Number.isFinite(computed)) {
    return { t: "n", v: computed, f: formula };
  }
  if (typeof computed === "boolean") {
    return { t: "b", v: computed, f: formula };
  }
  if (typeof computed === "string" && computed !== "") {
    if (/^-?\d+(\.\d+)?$/.test(computed.trim())) {
      const n = Number(computed);
      if (Number.isFinite(n)) return { t: "n", v: n, f: formula };
    }
    return { t: "s", v: computed, f: formula };
  }
  // Empty / unknown computed value — emit a numeric stub so Excel recalculates
  // the formula on open instead of caching an empty string (which displays as
  // blank even after recalc in some Excel versions).
  return { t: "n", v: 0, f: formula };
}
