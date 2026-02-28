import type { FormulaPickerHandle } from "@/pages/App/Spreadsheet/FormulaPickerDropdown";
import { useCallback, useEffect, useRef, useState } from "react";

interface FormulaPickerState {
  visible: boolean;
  position: { x: number; y: number };
  query: string;
}

/**
 * Manages formula picker state for the spreadsheet editor.
 * Handles input monitoring, keyboard interception, and formula insertion.
 */
export function useFormulaPicker() {
  const [formulaPicker, setFormulaPicker] =
    useState<FormulaPickerState | null>(null);
  const editorInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const inputListenerRef = useRef<(() => void) | null>(null);
  const scrollListenerRef = useRef<(() => void) | null>(null);
  const formulaPickerHandleRef = useRef<FormulaPickerHandle>(null);

  /** Call from jspreadsheet's `oneditionstart` callback. */
  const onEditionStart = useCallback(
    (td: HTMLTableCellElement, wrapper: HTMLElement) => {
      requestAnimationFrame(() => {
        const editorEl =
          td.querySelector<HTMLInputElement>("input") ??
          td.querySelector<HTMLTextAreaElement>("textarea");
        if (!editorEl) return;
        editorInputRef.current = editorEl;

        const onInput = () => {
          const value = editorEl.value;
          if (value.startsWith("=") && value.length >= 1) {
            const query = value.substring(1);
            if (!query.includes("(")) {
              const rect = td.getBoundingClientRect();
              setFormulaPicker({
                visible: true,
                position: { x: rect.left, y: rect.bottom + 2 },
                query,
              });
            } else {
              setFormulaPicker(null);
            }
          } else {
            setFormulaPicker(null);
          }
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
    },
    [],
  );

  /** Call from jspreadsheet's `oneditionend` callback. */
  const onEditionEnd = useCallback(() => {
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
    setFormulaPicker(null);
  }, []);

  /** Insert the selected formula into the active cell editor. */
  const insertFormula = useCallback((formulaName: string) => {
    const el = editorInputRef.current;
    if (!el) return;
    el.value = `=${formulaName}(`;
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    setFormulaPicker(null);
  }, []);

  /**
   * Register capture-phase keyboard interception on the wrapper element.
   * Must be called in a useEffect so it can be cleaned up.
   */
  const registerKeyboardInterception = useCallback(
    (wrapper: HTMLElement) => {
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
    },
    [formulaPicker?.visible, insertFormula],
  );

  return {
    formulaPicker,
    formulaPickerHandleRef,
    insertFormula,
    onEditionStart,
    onEditionEnd,
    registerKeyboardInterception,
  };
}
