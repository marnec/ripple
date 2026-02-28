import type { MenuState } from "@/hooks/use-spreadsheet-context-menu";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Rows3,
  Trash2,
} from "lucide-react";
import { type RefObject } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// Primitives
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
        destructive ? "text-destructive hover:text-destructive" : ""
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
// Menu Content
// ---------------------------------------------------------------------------

interface Actions {
  insertRowAbove: () => void;
  insertRowBelow: () => void;
  deleteRow: () => void;
  insertColLeft: () => void;
  insertColRight: () => void;
  deleteCol: () => void;
}

function MenuContent({
  actions,
  ctx,
}: {
  actions: Actions;
  ctx: MenuState["ctx"];
}) {
  switch (ctx.type) {
    case "row-header":
      return (
        <>
          <MenuItem onClick={actions.insertRowAbove}>
            <ArrowUpToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert row above
          </MenuItem>
          <MenuItem onClick={actions.insertRowBelow}>
            <ArrowDownToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert row below
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={actions.deleteRow} destructive>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete row
          </MenuItem>
        </>
      );

    case "col-header":
      return (
        <>
          <MenuItem onClick={actions.insertColLeft}>
            <ArrowLeftToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert column left
          </MenuItem>
          <MenuItem onClick={actions.insertColRight}>
            <ArrowRightToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert column right
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={actions.deleteCol} destructive>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete column
          </MenuItem>
        </>
      );

    case "cell":
      return (
        <>
          <MenuItem onClick={actions.insertRowAbove}>
            <ArrowUpToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert row above
          </MenuItem>
          <MenuItem onClick={actions.insertRowBelow}>
            <ArrowDownToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert row below
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={actions.insertColLeft}>
            <ArrowLeftToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert column left
          </MenuItem>
          <MenuItem onClick={actions.insertColRight}>
            <ArrowRightToLine className="mr-2 h-4 w-4 text-muted-foreground" />
            Insert column right
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={actions.deleteRow} destructive>
            <Rows3 className="mr-2 h-4 w-4" />
            Delete row
          </MenuItem>
          <MenuItem onClick={actions.deleteCol} destructive>
            <Columns3 className="mr-2 h-4 w-4" />
            Delete column
          </MenuItem>
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Portal Component
// ---------------------------------------------------------------------------

export function SpreadsheetContextMenu({
  menu,
  menuRef,
  actions,
}: {
  menu: MenuState;
  menuRef: RefObject<HTMLDivElement | null>;
  actions: Actions;
}) {
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-52 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ top: menu.y, left: menu.x }}
    >
      <MenuContent actions={actions} ctx={menu.ctx} />
    </div>,
    document.body,
  );
}
