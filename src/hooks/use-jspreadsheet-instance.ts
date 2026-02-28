import { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import jspreadsheet from "jspreadsheet-ce";
import { type RefObject, useEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

// jspreadsheet-ce doesn't export worksheet instance type cleanly
type Worksheet = any;

interface UseJSpreadsheetInstanceOptions {
  wrapperRef: RefObject<HTMLDivElement | null>;
  yDoc: Y.Doc;
  awareness: Awareness | null;
  onEditionStart: (td: HTMLTableCellElement, wrapper: HTMLElement) => void;
  onEditionEnd: () => void;
}

/**
 * Initializes a jspreadsheet-ce instance with Yjs two-way binding.
 * Manages the full lifecycle: create → bind → destroy.
 */
export function useJSpreadsheetInstance({
  wrapperRef,
  yDoc,
  awareness,
  onEditionStart,
  onEditionEnd,
}: UseJSpreadsheetInstanceOptions) {
  const worksheetRef = useRef<Worksheet>(null);
  const bindingRef = useRef<SpreadsheetYjsBinding | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    wrapper.innerHTML = "";
    const container = document.createElement("div");
    wrapper.appendChild(container);

    // Create a binding reference to wire up events
    let binding: SpreadsheetYjsBinding | null = null;

    const instance = jspreadsheet(container, {
      worksheets: [{ minDimensions: [30, 100] }],
      tabs: false,
      toolbar: false,
      contextMenu: () => null,
      onchange() {
        binding?.onchange();
      },
      onafterchanges(instance: any, changes: any) {
        binding?.onafterchanges(instance, changes);
      },
      oninsertrow(instance: any, rows: any) {
        binding?.oninsertrow(instance, rows);
      },
      ondeleterow(instance: any, removedRows: any) {
        binding?.ondeleterow(instance, removedRows);
      },
      oninsertcolumn(instance: any, columns: any) {
        binding?.oninsertcolumn(instance, columns);
      },
      ondeletecolumn(instance: any, removedColumns: any) {
        binding?.ondeletecolumn(instance, removedColumns);
      },
      onchangestyle(instance: any, changes: any) {
        binding?.onchangestyle(instance, changes);
      },
      onresizecolumn(instance: any, col: any, newW: any) {
        binding?.onresizecolumn(instance, col, newW);
      },
      onresizerow(instance: any, row: any, newH: any) {
        binding?.onresizerow(instance, row, newH);
      },
      onmerge(instance: any, merges: any) {
        binding?.onmerge(instance, merges);
      },
      onselection(instance: any, x1: any, y1: any, x2: any, y2: any) {
        binding?.onselection(instance, x1, y1, x2, y2);
      },
      oneditionstart(_instance: any, td: HTMLTableCellElement) {
        onEditionStart(td, wrapper);
      },
      oneditionend() {
        onEditionEnd();
      },
    });

    const worksheet = Array.isArray(instance) ? instance[0] : instance;
    worksheetRef.current = worksheet;

    // Create the two-way Yjs binding
    binding = new SpreadsheetYjsBinding(worksheet, yDoc, awareness);
    bindingRef.current = binding;

    return () => {
      // Destroy binding before jspreadsheet
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      binding = null;
      worksheetRef.current = null;

      try {
        jspreadsheet.destroy(
          container as unknown as jspreadsheet.JspreadsheetInstanceElement,
        );
      } catch {
        // jspreadsheet-ce may throw during destroy
      }
      wrapper.innerHTML = "";
    };
    // onEditionStart/onEditionEnd are stable callbacks from useFormulaPicker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yDoc, awareness]);

  return { worksheetRef, bindingRef };
}
