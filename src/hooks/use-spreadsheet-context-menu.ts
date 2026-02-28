import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClickContext =
  | { type: "cell"; row: number; col: number }
  | { type: "row-header"; row: number }
  | { type: "col-header"; col: number };

export interface MenuState {
  x: number;
  y: number;
  ctx: ClickContext;
}

// jspreadsheet-ce doesn't export worksheet instance type cleanly
type Worksheet = any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk up from the event target to determine what region was right-clicked. */
function resolveClickContext(
  target: HTMLElement,
  worksheetEl: HTMLElement | null,
): ClickContext | null {
  if (!worksheetEl) return null;

  let el: HTMLElement | null = target;
  while (el && el !== worksheetEl) {
    if (el.tagName === "TD") {
      const td = el as HTMLTableCellElement;
      const tr = td.closest("tr");
      if (!tr) return null;

      const isHeader = !!td.closest("thead");
      const isBody = !!td.closest("tbody");

      if (isHeader) {
        const col = td.cellIndex - 1;
        if (col < 0) return null;
        return { type: "col-header", col };
      }

      if (isBody) {
        const row = tr.rowIndex - 1;
        const col = td.cellIndex - 1;
        if (col < 0) {
          return { type: "row-header", row };
        }
        return { type: "cell", row, col };
      }
    }
    el = el.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the spreadsheet context menu: positioning, dismiss, and row/column actions.
 */
export function useSpreadsheetContextMenu(
  worksheetRef: RefObject<Worksheet | null>,
) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // --- Close menu on click-away / Escape ---
  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /**
   * Register the capture-phase contextmenu listener on a wrapper element.
   * Returns a cleanup function for use in useEffect.
   */
  const registerContextMenu = useCallback(
    (wrapper: HTMLElement) => {
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        const table = wrapper.querySelector(".jss_worksheet") as HTMLElement;
        const ctx = resolveClickContext(target, table);
        if (ctx) {
          const menuW = 220;
          const menuH = ctx.type === "cell" ? 240 : 130;
          const x = Math.min(e.clientX, window.innerWidth - menuW);
          const y = Math.min(e.clientY, window.innerHeight - menuH);
          setMenu({ x: Math.max(0, x), y: Math.max(0, y), ctx });
        } else {
          setMenu(null);
        }
      };

      wrapper.addEventListener("contextmenu", onContextMenu, true);
      return () =>
        wrapper.removeEventListener("contextmenu", onContextMenu, true);
    },
    [],
  );

  // --- Action helpers ---

  const act = useCallback(
    (fn: (w: Worksheet, ctx: ClickContext) => void) => {
      return () => {
        const w = worksheetRef.current;
        if (!w || !menu) return;
        fn(w, menu.ctx);
        setMenu(null);
      };
    },
    [menu, worksheetRef],
  );

  const actions = {
    insertRowAbove: act((w, ctx) => {
      const row = ctx.type === "col-header" ? 0 : ctx.row;
      w.insertRow(1, row, true);
    }),
    insertRowBelow: act((w, ctx) => {
      const row = ctx.type === "col-header" ? 0 : ctx.row;
      w.insertRow(1, row, false);
    }),
    deleteRow: act((w, ctx) => {
      const row = ctx.type === "col-header" ? 0 : ctx.row;
      w.deleteRow(row, 1);
    }),
    insertColLeft: act((w, ctx) => {
      const col = ctx.type === "row-header" ? 0 : ctx.col;
      w.insertColumn(1, col, true);
    }),
    insertColRight: act((w, ctx) => {
      const col = ctx.type === "row-header" ? 0 : ctx.col;
      w.insertColumn(1, col, false);
    }),
    deleteCol: act((w, ctx) => {
      const col = ctx.type === "row-header" ? 0 : ctx.col;
      w.deleteColumn(col, 1);
    }),
  };

  const dismiss = useCallback(() => setMenu(null), []);

  return { menu, menuRef, registerContextMenu, actions, dismiss };
}
