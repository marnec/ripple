import { LoadingSpinner } from "@/components/ui/loading-spinner";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jspreadsheet-ce/dist/jspreadsheet.themes.css";
import "jsuites/dist/jsuites.css";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Rows3,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClickContext =
  | { type: "cell"; row: number; col: number }
  | { type: "row-header"; row: number }
  | { type: "col-header"; col: number };

interface MenuState {
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
// Menu Item Component
// ---------------------------------------------------------------------------

function MenuItem({
  onClick,
  destructive,
  children,
}: {
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground ${
        destructive
          ? "text-destructive hover:text-destructive"
          : ""
      }`}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

// ---------------------------------------------------------------------------
// Grid Component
// ---------------------------------------------------------------------------

function JSpreadsheetGrid() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const worksheetRef = useRef<Worksheet>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // --- Initialise jspreadsheet ---
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    wrapper.innerHTML = "";
    const container = document.createElement("div");
    wrapper.appendChild(container);

    const instance = jspreadsheet(container, {
      worksheets: [{ minDimensions: [30, 100] }],
      tabs: false,
      toolbar: false,
      contextMenu: () => null,
    });

    worksheetRef.current = Array.isArray(instance) ? instance[0] : instance;

    // Capture-phase listener: fires before jspreadsheet can intercept.
    // preventDefault kills the browser menu; stopPropagation kills
    // jspreadsheet's internal handler. We manage our own menu via state.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      const table = wrapper.querySelector(".jss_worksheet") as HTMLElement;
      const ctx = resolveClickContext(target, table);
      if (ctx) {
        // Clamp to viewport so menu doesn't overflow off-screen
        const menuW = 220; // min-w-52 ≈ 13rem ≈ 208px + padding
        const menuH = ctx.type === "cell" ? 240 : 130;
        const x = Math.min(e.clientX, window.innerWidth - menuW);
        const y = Math.min(e.clientY, window.innerHeight - menuH);
        setMenu({ x: Math.max(0, x), y: Math.max(0, y), ctx });
      } else {
        setMenu(null);
      }
    };

    wrapper.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      wrapper.removeEventListener("contextmenu", onContextMenu, true);
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
  }, []);

  // --- Close menu on click-away / Escape ---
  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onMouseDown = (e: MouseEvent) => {
      // Don't close if clicking inside the menu itself
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

  // --- Action helpers ---

  const ws = () => worksheetRef.current;

  const act = useCallback(
    (fn: (w: Worksheet, ctx: ClickContext) => void) => {
      return () => {
        const w = ws();
        if (!w || !menu) return;
        fn(w, menu.ctx);
        setMenu(null);
      };
    },
    [menu],
  );

  const insertRowAbove = act((w, ctx) => {
    const row = ctx.type === "col-header" ? 0 : ctx.row;
    w.insertRow(1, row, true);
  });

  const insertRowBelow = act((w, ctx) => {
    const row = ctx.type === "col-header" ? 0 : ctx.row;
    w.insertRow(1, row, false);
  });

  const deleteRow = act((w, ctx) => {
    const row = ctx.type === "col-header" ? 0 : ctx.row;
    w.deleteRow(row, 1);
  });

  const insertColLeft = act((w, ctx) => {
    const col = ctx.type === "row-header" ? 0 : ctx.col;
    w.insertColumn(1, col, true);
  });

  const insertColRight = act((w, ctx) => {
    const col = ctx.type === "row-header" ? 0 : ctx.col;
    w.insertColumn(1, col, false);
  });

  const deleteCol = act((w, ctx) => {
    const col = ctx.type === "row-header" ? 0 : ctx.col;
    w.deleteColumn(col, 1);
  });

  // --- Render ---

  const renderMenuContent = () => {
    if (!menu) return null;

    switch (menu.ctx.type) {
      case "row-header":
        return (
          <>
            <MenuItem onClick={insertRowAbove}>
              <ArrowUpToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert row above
            </MenuItem>
            <MenuItem onClick={insertRowBelow}>
              <ArrowDownToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert row below
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={deleteRow} destructive>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete row
            </MenuItem>
          </>
        );

      case "col-header":
        return (
          <>
            <MenuItem onClick={insertColLeft}>
              <ArrowLeftToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert column left
            </MenuItem>
            <MenuItem onClick={insertColRight}>
              <ArrowRightToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert column right
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={deleteCol} destructive>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete column
            </MenuItem>
          </>
        );

      case "cell":
        return (
          <>
            <MenuItem onClick={insertRowAbove}>
              <ArrowUpToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert row above
            </MenuItem>
            <MenuItem onClick={insertRowBelow}>
              <ArrowDownToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert row below
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={insertColLeft}>
              <ArrowLeftToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert column left
            </MenuItem>
            <MenuItem onClick={insertColRight}>
              <ArrowRightToLine className="mr-2 h-4 w-4 text-muted-foreground" />
              Insert column right
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={deleteRow} destructive>
              <Rows3 className="mr-2 h-4 w-4" />
              Delete row
            </MenuItem>
            <MenuItem onClick={deleteCol} destructive>
              <Columns3 className="mr-2 h-4 w-4" />
              Delete column
            </MenuItem>
          </>
        );

    }
  };

  return (
    <>
      <div ref={wrapperRef} className="h-full" />
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 min-w-52 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            style={{ top: menu.y, left: menu.x }}
          >
            {renderMenuContent()}
          </div>,
          document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page Components
// ---------------------------------------------------------------------------

function SpreadsheetEditor({
  spreadsheetId,
}: {
  spreadsheetId: Id<"spreadsheets">;
}) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });

  if (spreadsheet === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (spreadsheet === null) {
    return <SomethingWentWrong />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-hidden">
        <JSpreadsheetGrid />
      </div>
    </div>
  );
}

export function SpreadsheetPage() {
  const { spreadsheetId } = useParams<QueryParams>();

  if (!spreadsheetId) return <SomethingWentWrong />;

  return <SpreadsheetEditor key={spreadsheetId} spreadsheetId={spreadsheetId} />;
}
