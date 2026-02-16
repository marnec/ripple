import { useIsMobile } from "@/hooks/use-mobile";
import { Table2, FilePen, MoreHorizontal, Settings, Trash2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem
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
    <SidebarMenuItem key={spreadsheet._id}>
      <SidebarMenuButton
        asChild
        variant={spreadsheet._id === spreadsheetId ? "outline" : "default"}
        onClick={() => onSpreadsheetSelect(spreadsheet._id)}
      >
        <div>
          <Table2 /> {spreadsheet.name}
        </div>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
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
    </SidebarMenuItem>
  );
}
