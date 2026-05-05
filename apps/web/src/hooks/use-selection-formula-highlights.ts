import { extractCellRefs } from "@/lib/spreadsheet-formula-refs";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { useEffect, useSyncExternalStore } from "react";

interface UseSelectionFormulaHighlightsOptions {
  binding: SpreadsheetYjsBinding | null;
  selection: { row: number; col: number } | null;
  /** When true, an active editor (FormulaBar or in-cell) owns the highlights
   *  and this hook stays out of the way. */
  suppressed: boolean;
}

/**
 * Drive formula edit highlights from the currently selected cell — when the
 * cell holds a formula and no editor is active, highlight its referenced
 * cells. Subscribes to the binding so remote edits to the selected cell
 * (e.g. another client's formula change, undo) refresh highlights live.
 */
export function useSelectionFormulaHighlights({
  binding,
  selection,
  suppressed,
}: UseSelectionFormulaHighlightsOptions) {
  const cellValue = useSyncExternalStore(
    (l) => binding?.subscribe(l) ?? (() => {}),
    () =>
      binding && selection
        ? binding.getRawCellValue(selection.row, selection.col)
        : "",
  );

  useEffect(() => {
    if (!binding) return;
    if (suppressed) return;
    if (cellValue.startsWith("=")) {
      binding.setFormulaEditHighlights(
        extractCellRefs(cellValue).map((m) => m.ref),
      );
    } else {
      binding.clearFormulaEditHighlights();
    }
  }, [binding, cellValue, suppressed]);
}
