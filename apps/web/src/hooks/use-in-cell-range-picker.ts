import {
  applyRefPick,
  formatSelectionRef,
  selectionFromDrag,
} from "@/lib/spreadsheet-formula-refs";
import { type RefObject, useEffect } from "react";

type EditorElement = HTMLInputElement | HTMLTextAreaElement;
type Cell = { row: number; col: number };

interface UseInCellRangePickerOptions {
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** The in-cell editor element, non-null only while jspreadsheet is editing
   *  a cell (owned by `useFormulaPicker`). */
  editorRef: RefObject<EditorElement | null>;
}

/** The `<td>` under an event target, or null for headers, corners, gutters. */
function cellAt(target: EventTarget | null): Cell | null {
  const el = target instanceof Element ? target : null;
  const td = el?.closest("td[data-x][data-y]");
  if (!td) return null;
  const col = Number(td.getAttribute("data-x"));
  const row = Number(td.getAttribute("data-y"));
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

/**
 * Click- and drag-to-pick cell references for the **in-cell** formula editor.
 *
 * The formula bar gets this for free — it lives outside the grid, so
 * jspreadsheet keeps handling selection and `useCellPicker` reads it back. The
 * in-cell editor cannot: jspreadsheet's own `mousedown` handler closes the
 * editor the moment the pointer lands on a different cell, and the editor
 * commits on blur besides. So while a formula is being typed in-cell this hook
 * swallows the gesture in the capture phase — `stopPropagation` keeps
 * jspreadsheet's document-level listener from ever seeing it, `preventDefault`
 * keeps focus in the editor — and drives the pick itself.
 *
 * The dragged range is spliced straight into the editor's value; the synthetic
 * `input` event then feeds the existing formula-highlight path, so the range
 * lights up on the grid as it grows.
 */
export function useInCellRangePicker({
  wrapperRef,
  editorRef,
}: UseInCellRangePickerOptions) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // The span the last pick wrote, so a drag rewrites one growing ref instead
    // of appending one per cell crossed.
    let span: { start: number; end: number } | null = null;
    // What we last left in the editor. Anything else means the user typed or
    // moved the caret since, so the next pick starts a fresh insertion.
    let lastWrite: { value: string; cursor: number } | null = null;
    let anchor: Cell | null = null;

    const write = (head: Cell) => {
      const el = editorRef.current;
      if (!el || !anchor) return;
      const ref = formatSelectionRef(selectionFromDrag(anchor, head));
      const picked = applyRefPick(
        el.value,
        el.selectionStart ?? el.value.length,
        ref,
        span,
      );
      span = picked.span;
      el.value = picked.text;
      el.setSelectionRange(picked.cursor, picked.cursor);
      lastWrite = { value: picked.text, cursor: picked.cursor };
      // Drives the formula picker and the grid's edit highlights.
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const endDrag = (e: MouseEvent) => {
      if (!anchor) return;
      anchor = null;
      // jspreadsheet never saw the mousedown; don't let it see the mouseup
      // either, or it re-derives selection state from a gesture it missed.
      e.stopPropagation();
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", endDrag, true);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!anchor) return;
      const head = cellAt(e.target);
      if (!head) return;
      e.preventDefault();
      e.stopPropagation();
      write(head);
    };

    const onMouseDown = (e: MouseEvent) => {
      const el = editorRef.current;
      if (!el || e.button !== 0) return;
      // Only formulas take refs, and a click inside the editor is the user
      // placing their own caret.
      if (!el.value.startsWith("=")) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      const cell = cellAt(e.target);
      if (!cell) return;

      e.preventDefault();
      e.stopPropagation();

      const cursor = el.selectionStart ?? el.value.length;
      if (
        !lastWrite ||
        lastWrite.value !== el.value ||
        lastWrite.cursor !== cursor
      ) {
        span = null;
      }
      anchor = cell;
      write(cell);

      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", endDrag, true);
    };

    wrapper.addEventListener("mousedown", onMouseDown, true);
    return () => {
      wrapper.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", endDrag, true);
    };
  }, [wrapperRef, editorRef]);
}
