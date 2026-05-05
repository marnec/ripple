import type { CellObject, WorkSheet } from "xlsx";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { sanitizeFilename, triggerDownload } from "@/lib/download-blob";

// `xlsx`'s shipped types don't model the `CalcPr` workbook child we set to
// force a full recalculation on file open. Augment the module so we don't
// have to cast the workbook.
declare module "xlsx" {
  interface WBProps {
    CalcPr?: { fullCalcOnLoad?: boolean };
  }
}

/** The narrow surface we depend on from a jspreadsheet-ce v5 worksheet
 *  instance (which is otherwise untyped). Keeping this here means the rest
 *  of the export code can stay strict. */
interface WorksheetLike {
  getData(): string[][];
  getValueFromCoords(col: number, row: number, processed?: boolean): unknown;
  download(includeHeaders?: boolean): void;
  options?: { worksheetName?: string };
}

function getWorksheet(binding: SpreadsheetYjsBinding): WorksheetLike {
  const ws = binding.getWorksheet() as WorksheetLike | null;
  if (!ws?.getData || !ws.download) throw new Error("Spreadsheet not ready");
  return ws;
}

export function exportSpreadsheetCsv(binding: SpreadsheetYjsBinding, name: string): void {
  const worksheet = getWorksheet(binding);
  // jspreadsheet-ce names the downloaded CSV after `worksheet.options.worksheetName`.
  // Override it temporarily so the file matches the resource's display name.
  const previousName = worksheet.options?.worksheetName;
  if (worksheet.options) worksheet.options.worksheetName = sanitizeFilename(name);
  try {
    worksheet.download(false);
  } finally {
    if (worksheet.options) worksheet.options.worksheetName = previousName;
  }
}

export async function exportSpreadsheetXlsx(
  binding: SpreadsheetYjsBinding,
  name: string,
): Promise<void> {
  const worksheet = getWorksheet(binding);
  const XLSX = await import("xlsx");

  // jspreadsheet stores everything as strings — formulas as `=…`. Without
  // type promotion, SheetJS writes them as text cells (Excel shows the
  // leading apostrophe). We convert formulas into formula cells with a
  // cached computed value, and numeric strings into number cells. SheetJS's
  // `aoa_to_sheet` accepts `CellObject`s mixed with primitives in the
  // input array.
  const raw = worksheet.getData();
  const aoa: (string | number | CellObject | null)[][] = raw.map((row, r) =>
    row.map((cell, c) => coerceCell(cell, r, c, worksheet)),
  );
  const sheet: WorkSheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  // Force Excel to recompute formulas on open so cached values match
  // jspreadsheet's evaluator (which may differ in subtle precision/locale).
  book.Workbook = { ...(book.Workbook ?? {}), CalcPr: { fullCalcOnLoad: true } };

  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${sanitizeFilename(name)}.xlsx`,
  );
}

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

function coerceCell(
  value: string,
  row: number,
  col: number,
  worksheet: WorksheetLike,
): string | number | CellObject | null {
  if (value === "") return null;
  if (value.startsWith("=")) {
    let computed: unknown = "";
    try {
      computed = worksheet.getValueFromCoords(col, row, true);
    } catch { /* leave empty */ }
    return formulaCell(value.slice(1), computed);
  }
  if (NUMERIC_RE.test(value.trim())) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function formulaCell(formula: string, computed: unknown): CellObject {
  if (typeof computed === "number" && Number.isFinite(computed)) {
    return { t: "n", v: computed, f: formula };
  }
  if (typeof computed === "boolean") {
    return { t: "b", v: computed, f: formula };
  }
  if (typeof computed === "string" && computed !== "") {
    if (NUMERIC_RE.test(computed.trim())) {
      const n = Number(computed);
      if (Number.isFinite(n)) return { t: "n", v: n, f: formula };
    }
    return { t: "s", v: computed, f: formula };
  }
  // Empty / unknown computed value — emit a numeric stub (0) so Excel
  // recalculates the formula on open instead of caching an empty string
  // (which would render blank even after recalc in some Excel versions).
  return { t: "n", v: 0, f: formula };
}
