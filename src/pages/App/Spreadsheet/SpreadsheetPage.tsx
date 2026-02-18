
import { useCursorAwareness } from "@/hooks/use-cursor-awareness";
import { useSpreadsheetCollaboration } from "@/hooks/use-spreadsheet-collaboration";
import { SpreadsheetYjsBinding } from "@/lib/spreadsheet-yjs-binding";
import { getUserColor } from "@/lib/user-colors";
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
  Circle,
  Columns3,
  Rows3,
  Trash2,
  WifiOff,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ActiveUsers } from "../Document/ActiveUsers";

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
// Connection Status Badge
// ---------------------------------------------------------------------------

function ConnectionStatus({
  isConnected,
  isOffline,
}: {
  isConnected: boolean;
  isOffline: boolean;
}) {
  if (isOffline) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <WifiOff className="h-3 w-3" />
        Offline
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Circle
        className={`h-2 w-2 fill-current ${isConnected ? "text-green-500" : "text-yellow-500"}`}
      />
      {isConnected ? "Connected" : "Connecting..."}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid Component
// ---------------------------------------------------------------------------

const JSpreadsheetGrid = memo(function JSpreadsheetGrid({
  yDoc,
  awareness,
  remoteUserClientIds,
}: {
  yDoc: Y.Doc;
  awareness: Awareness | null;
  remoteUserClientIds: Set<number>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const worksheetRef = useRef<Worksheet>(null);
  const bindingRef = useRef<SpreadsheetYjsBinding | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // --- Initialise jspreadsheet + Yjs binding ---
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
      // Wire jspreadsheet v5 events to the Yjs binding
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
    });

    const worksheet = Array.isArray(instance) ? instance[0] : instance;
    worksheetRef.current = worksheet;

    // Create the two-way Yjs binding
    binding = new SpreadsheetYjsBinding(worksheet, yDoc, awareness);
    bindingRef.current = binding;

    // Capture-phase listener: fires before jspreadsheet can intercept.
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

    return () => {
      wrapper.removeEventListener("contextmenu", onContextMenu, true);

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
  }, [yDoc, awareness]);

  // --- Sync active client IDs to binding (remove stale cursors) ---
  useEffect(() => {
    bindingRef.current?.setActiveClients(remoteUserClientIds);
  }, [remoteUserClientIds]);

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
});

// ---------------------------------------------------------------------------
// Page Components
// ---------------------------------------------------------------------------

function SpreadsheetEditor({
  spreadsheetId,
}: {
  spreadsheetId: Id<"spreadsheets">;
}) {
  const spreadsheet = useQuery(api.spreadsheets.get, { id: spreadsheetId });
  const viewer = useQuery(api.users.viewer);

  const {
    yDoc,
    awareness,
    isConnected,
    isOffline,
    isLoading: collabLoading,
  } = useSpreadsheetCollaboration({
    spreadsheetId: spreadsheetId as string,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "unknown",
  });

  const { remoteUsers } = useCursorAwareness(awareness);

  const remoteUserClientIds = useMemo(
    () => new Set(remoteUsers.map((u) => u.clientId)),
    [remoteUsers],
  );

  if (spreadsheet === undefined || viewer === undefined) {
    return <div className="h-full w-full" />;
  }

  if (spreadsheet === null) {
    return <SomethingWentWrong />;
  }

  if (collabLoading) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="flex h-full w-full flex-col animate-fade-in">
      <div className="flex items-center justify-end px-3 py-1.5 border-b">
        <div className="flex h-8 items-center gap-3">
          <ConnectionStatus isConnected={isConnected} isOffline={isOffline} />
          {isConnected && (
            <ActiveUsers
              remoteUsers={remoteUsers}
              currentUser={
                viewer
                  ? { name: viewer.name, color: getUserColor(viewer._id) }
                  : undefined
              }
            />
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <JSpreadsheetGrid yDoc={yDoc} awareness={awareness} remoteUserClientIds={remoteUserClientIds} />
      </div>
    </div>
  );
}

export function SpreadsheetPage() {
  const { spreadsheetId } = useParams<QueryParams>();

  if (!spreadsheetId) return <SomethingWentWrong />;

  return <SpreadsheetEditor key={spreadsheetId} spreadsheetId={spreadsheetId} />;
}
