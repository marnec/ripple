import { shiftFormula, type ShiftOp } from "@/lib/formulaShift";

export type { ShiftOp };

export interface FormulaShiftRewrite {
  row: number;
  col: number;
  next: string;
}

/**
 * Walk a 2D snapshot of cell strings, identify formula cells, and compute the
 * post-shift rewrites that apply for the given structural operation. Pure —
 * no Yjs, no DOM, no jspreadsheet — so it can be unit-tested directly.
 *
 * The caller is responsible for actually writing the rewrites back to its
 * data store (see `SpreadsheetYjsBinding.shiftFormulaRefs` for the live wiring).
 */
export function planFormulaShift(
  cells: ReadonlyArray<ReadonlyArray<string>>,
  op: ShiftOp,
): FormulaShiftRewrite[] {
  const rewrites: FormulaShiftRewrite[] = [];
  for (let row = 0; row < cells.length; row++) {
    const r = cells[row];
    for (let col = 0; col < r.length; col++) {
      const value = r[col] ?? "";
      if (!value.startsWith("=")) continue;
      const next = shiftFormula(value, op);
      if (next !== value) rewrites.push({ row, col, next });
    }
  }
  return rewrites;
}
