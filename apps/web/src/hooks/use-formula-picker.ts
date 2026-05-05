import { extractCellRefs } from "@/lib/spreadsheet-formula-refs";
import {
  filterFormulas,
  getFormulaPickerContext,
} from "@/lib/spreadsheet-formulas";
import type { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import type { FormulaPickerHandle } from "@/pages/App/Spreadsheet/FormulaPickerDropdown";
import { type RefObject, useRef, useState } from "react";

interface FormulaPickerState {
  visible: boolean;
  position: { x: number; y: number };
  query: string;
}

/**
 * Manages formula picker state for the spreadsheet editor.
 * Handles input monitoring, keyboard interception, and formula insertion.
 *
 * If `bindingRef` is provided, also drives live cell-reference highlights
 * on the grid as the user types a formula in-cell.
 */
export function useFormulaPicker(
  bindingRef?: RefObject<SpreadsheetYjsBinding | null>,
) {
  const [formulaPicker, setFormulaPicker] =
    useState<FormulaPickerState | null>(null);
  const editorInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const inputListenerRef = useRef<(() => void) | null>(null);
  const scrollListenerRef = useRef<(() => void) | null>(null);
  const formulaPickerHandleRef = useRef<FormulaPickerHandle>(null);

  /** Call from jspreadsheet's `oneditionstart` callback. */
  const onEditionStart = (td: HTMLTableCellElement, wrapper: HTMLElement) => {
    requestAnimationFrame(() => {
      const editorEl =
        td.querySelector<HTMLInputElement>("input") ??
        td.querySelector<HTMLTextAreaElement>("textarea");
      if (!editorEl) return;
      editorInputRef.current = editorEl;

      const onInput = () => {
        const value = editorEl.value;
        const cursor = editorEl.selectionStart ?? value.length;

        // Live cell-reference highlights — independent of the picker dropdown.
        const binding = bindingRef?.current;
        if (binding) {
          if (value.startsWith("=")) {
            binding.setFormulaEditHighlights(
              extractCellRefs(value).map((m) => m.ref),
            );
          } else {
            binding.clearFormulaEditHighlights();
          }
        }

        const ctx = getFormulaPickerContext(value, cursor);
        if (!ctx || filterFormulas(ctx.query).length === 0) {
          setFormulaPicker(null);
          return;
        }
        const rect = td.getBoundingClientRect();
        setFormulaPicker({
          visible: true,
          position: { x: rect.left, y: rect.bottom + 2 },
          query: ctx.query,
        });
      };

      editorEl.addEventListener("input", onInput);
      inputListenerRef.current = onInput;

      // Dismiss on scroll
      const scrollContainer =
        wrapper.querySelector(".jss_content") || wrapper;
      const onScroll = () => setFormulaPicker(null);
      scrollContainer.addEventListener("scroll", onScroll, {
        passive: true,
      });
      scrollListenerRef.current = () =>
        scrollContainer.removeEventListener("scroll", onScroll);

      // Check initial value (user may have typed "=" to trigger editor)
      onInput();
    });
  };

  /** Call from jspreadsheet's `oneditionend` callback. */
  const onEditionEnd = () => {
    if (editorInputRef.current && inputListenerRef.current) {
      editorInputRef.current.removeEventListener(
        "input",
        inputListenerRef.current,
      );
    }
    scrollListenerRef.current?.();
    editorInputRef.current = null;
    inputListenerRef.current = null;
    scrollListenerRef.current = null;
    bindingRef?.current?.clearFormulaEditHighlights();
    setFormulaPicker(null);
  };

  /** Insert the selected formula into the active cell editor. */
  const insertFormula = (formulaName: string) => {
    const el = editorInputRef.current;
    if (!el) return;
    const value = el.value;
    const cursor = el.selectionStart ?? value.length;
    const ctx = getFormulaPickerContext(value, cursor);
    if (!ctx) return;
    const newBefore =
      value.substring(0, ctx.partialStart) + formulaName + "(";
    el.value = newBefore + value.substring(cursor);
    const newCursor = newBefore.length;
    el.selectionStart = newCursor;
    el.selectionEnd = newCursor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    setFormulaPicker(null);
  };

  /**
   * Register capture-phase keyboard interception on the wrapper element.
   * Must be called in a useEffect so it can be cleaned up.
   */
  const registerKeyboardInterception = (wrapper: HTMLElement) => {
    if (!formulaPicker?.visible) return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.stopPropagation();
        e.preventDefault();
        formulaPickerHandleRef.current?.handleKey(e.key);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.stopPropagation();
        e.preventDefault();
        const selected = formulaPickerHandleRef.current?.handleKey("Enter");
        if (selected) insertFormula(selected);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        setFormulaPicker(null);
      }
    };

    wrapper.addEventListener("keydown", onKeyDown, true);
    return () => wrapper.removeEventListener("keydown", onKeyDown, true);
  };

  return {
    formulaPicker,
    formulaPickerHandleRef,
    insertFormula,
    onEditionStart,
    onEditionEnd,
    registerKeyboardInterception,
  };
}
