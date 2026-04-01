import { memo } from "react";
import { Plus, Table2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { preselectSearchTab } from "../Resources/sidebar-constants";

export type SpreadsheetSelectorProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets"> | undefined;
  onSpreadsheetSelect: (id: string | null) => void;
  spreadsheets?: { _id: string; name: string; tags?: string[]; _creationTime: number }[];
};

export const SpreadsheetSelectorList = memo(function SpreadsheetSelectorList({
  workspaceId,
  onSpreadsheetSelect,
}: SpreadsheetSelectorProps) {
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/spreadsheets");

  const createSpreadsheet = useMutation(api.spreadsheets.create);

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "spreadsheet");
    onSpreadsheetSelect(null);
  };

  const handleCreate = async () => {
    if (isMobile) setSidebarOpen(false);
    const id = await createSpreadsheet({ workspaceId });
    onSpreadsheetSelect(id);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Spreadsheets" onClick={handleHeaderClick} isActive={isListActive}>
        <Table2 className="size-4" />
        <span className="font-medium">Spreadsheets</span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
        <Plus />
        <span className="sr-only">New Spreadsheet</span>
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
});
