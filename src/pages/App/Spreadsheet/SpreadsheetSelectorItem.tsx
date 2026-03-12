import { useIsMobile } from "@/hooks/use-mobile";
import { FilePen, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "../../../components/ui/sidebar";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

export interface SpreadsheetSelectorItemProps {
  spreadsheet: Doc<"spreadsheets">;
  spreadsheetId: Id<"spreadsheets"> | undefined;
  onSpreadsheetSelect: (id: string) => void;
  onRenameSpreadsheet: (id: Id<"spreadsheets">) => void;
  onManageSpreadsheet: (id: Id<"spreadsheets">) => void;
  onDeleteSpreadsheet: (id: Id<"spreadsheets">) => void;
}

export function SpreadsheetSelectorItem({
  spreadsheet,
  spreadsheetId,
  onSpreadsheetSelect,
  onRenameSpreadsheet,
  onManageSpreadsheet,
  onDeleteSpreadsheet
}: SpreadsheetSelectorItemProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarMenuSubItem className="group/subitem relative">
      <SidebarMenuSubButton
        render={<div onClick={() => onSpreadsheetSelect(spreadsheet._id)} className="cursor-pointer pr-6" />}
        isActive={spreadsheet._id === spreadsheetId}
      >
          <span className="truncate">{spreadsheet.name}</span>
      </SidebarMenuSubButton>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onClick={() => onRenameSpreadsheet(spreadsheet._id)}>
            <FilePen className="text-muted-foreground" />
            <span>Rename</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageSpreadsheet(spreadsheet._id)}>
            <Settings className="text-muted-foreground" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteSpreadsheet(spreadsheet._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuSubItem>
  );
}
