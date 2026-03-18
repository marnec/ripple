import { FilePen, MoreHorizontal, Settings, StarOff } from "lucide-react";
import {
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "../../../components/ui/sidebar";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";

import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { SIDEBAR_ELEMENT_FADEIN_DELAY } from "../Resources/sidebar-constants";

export interface SpreadsheetSelectorItemProps {
  idx: number;
  spreadsheet: Pick<Doc<"spreadsheets">, "_id" | "name">;
  spreadsheetId: Id<"spreadsheets"> | undefined;
  onSpreadsheetSelect: (id: string) => void;
  onRenameSpreadsheet: (id: Id<"spreadsheets">) => void;
  onManageSpreadsheet: (id: Id<"spreadsheets">) => void;
  onUnstarSpreadsheet: (id: Id<"spreadsheets">) => void;
}

export function SpreadsheetSelectorItem({
  idx,
  spreadsheet,
  spreadsheetId,
  onSpreadsheetSelect,
  onRenameSpreadsheet,
  onManageSpreadsheet,
  onUnstarSpreadsheet
}: SpreadsheetSelectorItemProps) {
  return (
    <SidebarMenuSubItem className="group/subitem relative animate-fade-in"
      style={{ animationDelay: `${idx * SIDEBAR_ELEMENT_FADEIN_DELAY}ms`, animationFillMode: "backwards" }}>
      <SidebarMenuSubButton
        render={<div
          onClick={() => onSpreadsheetSelect(spreadsheet._id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSpreadsheetSelect(spreadsheet._id);
            }
          }}
          className="cursor-pointer pr-6"
        />}
        isActive={spreadsheet._id === spreadsheetId}
      >
          <span className="truncate">{spreadsheet.name}</span>
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onSelect={() => onRenameSpreadsheet(spreadsheet._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onSelect={() => onManageSpreadsheet(spreadsheet._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          <ResponsiveDropdownMenuItem onSelect={() => onUnstarSpreadsheet(spreadsheet._id)}>
            <StarOff className="text-muted-foreground" />
            <span>Unstar</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
