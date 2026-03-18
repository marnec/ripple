import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { useMutation } from "convex/react";
import { memo, useMemo, useState } from "react";
import { ChevronRight, Plus, Table2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "../../../components/ui/sidebar";
import { SpreadsheetSelectorItem } from "./SpreadsheetSelectorItem";
import { RenameSpreadsheetDialog } from "./RenameSpreadsheetDialog";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

import type { AllFavoriteIds } from "../Document/DocumentSelectorList";

export type SpreadsheetSelectorProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets"> | undefined;
  onSpreadsheetSelect: (id: string | null) => void;
  spreadsheets?: { _id: string; name: string; tags?: string[]; _creationTime: number }[];
  allFavoriteIds: AllFavoriteIds | undefined;
  isOpen: boolean;
  onToggle: () => void;
};

export const SpreadsheetSelectorList = memo(function SpreadsheetSelectorList({
  workspaceId,
  spreadsheetId,
  onSpreadsheetSelect,
  spreadsheets: spreadsheetsProp,
  allFavoriteIds,
  isOpen,
  onToggle,
}: SpreadsheetSelectorProps) {
  const [selectedSpreadsheetForRename, setSelectedSpreadsheetForRename] = useState<Id<"spreadsheets"> | null>(null);
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/spreadsheets");

  const spreadsheets = spreadsheetsProp as unknown as Doc<"spreadsheets">[] | undefined;
  const createSpreadsheet = useMutation(api.spreadsheets.create);
  const toggleFavorite = useMutation(api.favorites.toggle);

  const favoriteSet = useMemo(() => new Set(allFavoriteIds?.spreadsheet ?? []), [allFavoriteIds]);
  const favoriteSheets = useMemo(
    () => spreadsheets?.filter((s) => favoriteSet.has(s._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [spreadsheets, favoriteSet],
  );

  const handleUnstar = (id: Id<"spreadsheets">) => {
    void toggleFavorite({ workspaceId, resourceType: "spreadsheet", resourceId: id });
  };

  const navigateToSpreadsheetSettings = (id: Id<"spreadsheets">) => {
    if (isMobile) setSidebarOpen(false);
    void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}/settings`);
  };

  const handleCreate = async () => {
    const id = await createSpreadsheet({ workspaceId });
    onSpreadsheetSelect(id);
  };

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "spreadsheet");
    onSpreadsheetSelect(null);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Spreadsheets" onClick={handleHeaderClick} isActive={isListActive}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <Table2 className="size-4" />
          <span className="font-medium">Spreadsheets</span>
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
          <Plus />
          <span className="sr-only">New Spreadsheet</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            {favoriteSheets?.map((spreadsheet, idx) => (
              <SpreadsheetSelectorItem
                key={spreadsheet._id}
                idx={idx}
                spreadsheet={spreadsheet}
                spreadsheetId={spreadsheetId}
                onSpreadsheetSelect={onSpreadsheetSelect}
                onRenameSpreadsheet={setSelectedSpreadsheetForRename}
                onManageSpreadsheet={navigateToSpreadsheetSettings}
                onUnstarSpreadsheet={handleUnstar}
              />
            ))}
            <EmptyFavoriteSlots filled={favoriteSheets?.length ?? 0} workspaceId={workspaceId} resourceType="spreadsheet" />
          </SidebarMenuSub>
        </CollapsibleContent>
        {!!selectedSpreadsheetForRename && (
          <RenameSpreadsheetDialog
            spreadsheetId={selectedSpreadsheetForRename}
            open={!!selectedSpreadsheetForRename}
            onOpenChange={(open: boolean) => !open && setSelectedSpreadsheetForRename(null)}
          />
        )}
    </Collapsible>
  );
});
