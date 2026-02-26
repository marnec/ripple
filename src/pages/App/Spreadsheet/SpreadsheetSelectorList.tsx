import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useMutation, useQuery } from "convex/react";
import { Search, Table2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
import { SpreadsheetSelectorItem } from "./SpreadsheetSelectorItem";
import { RenameSpreadsheetDialog } from "./RenameSpreadsheetDialog";
import { SidebarSearchInput } from "../Sidebar/SidebarSearchInput";

export type SpreadsheetSelectorProps = {
  workspaceId: Id<"workspaces">;
  spreadsheetId: Id<"spreadsheets"> | undefined;
  onSpreadsheetSelect: (id: string | null) => void;
};

export function SpreadsheetSelectorList({
  workspaceId,
  spreadsheetId,
  onSpreadsheetSelect,
}: SpreadsheetSelectorProps) {
  const [selectedSpreadsheetForRename, setSelectedSpreadsheetForRename] = useState<Id<"spreadsheets"> | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const deletingIdRef = useRef<string | null>(null);

  const spreadsheets = useQuery(api.spreadsheets.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "spreadsheet" });
  const createNewSpreadsheet = useMutation(api.spreadsheets.create);

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteSheets = useMemo(
    () => spreadsheets?.filter((s) => favoriteSet.has(s._id)),
    [spreadsheets, favoriteSet],
  );
  const { requestDelete, dialog: deleteDialog } = useConfirmedDelete("spreadsheet", {
    onDeleted: () => {
      if (deletingIdRef.current && window.location.pathname.includes(deletingIdRef.current)) {
        onSpreadsheetSelect(null);
      }
      deletingIdRef.current = null;
    },
  });

  const handleSpreadsheetDelete = (id: Id<"spreadsheets">) => {
    deletingIdRef.current = id;
    const spreadsheet = spreadsheets?.find((s) => s._id === id);
    void requestDelete(id, spreadsheet?.name ?? "Untitled");
  };

  const navigateToSpreadsheetSettings = (id: Id<"spreadsheets">) => {
    void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}/settings`);
  };

  const handleSpreadsheetCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewSpreadsheet({ workspaceId });
    onSpreadsheetSelect(id);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Spreadsheets</SidebarGroupLabel>
      <div className="absolute right-3 top-3.5 flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
        <button onClick={() => setShowSearch((s) => !s)} title="Search spreadsheets" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <Search />
        </button>
        <button onClick={() => void handleSpreadsheetCreate()} title="Create spreadsheet" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <Table2 />
        </button>
      </div>
      {showSearch && (
        <SidebarSearchInput
          workspaceId={workspaceId}
          resourceRoute="spreadsheets"
          onClose={() => setShowSearch(false)}
        />
      )}
      <SidebarMenu>
        {favoriteSheets?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No starred spreadsheets</p>
        )}
        {favoriteSheets?.map((spreadsheet) => (
          <SpreadsheetSelectorItem
            key={spreadsheet._id}
            spreadsheet={spreadsheet}
            spreadsheetId={spreadsheetId}
            onSpreadsheetSelect={onSpreadsheetSelect}
            onRenameSpreadsheet={setSelectedSpreadsheetForRename}
            onManageSpreadsheet={navigateToSpreadsheetSettings}
            onDeleteSpreadsheet={(id) => handleSpreadsheetDelete(id)}
          />
        ))}
      </SidebarMenu>
      {deleteDialog}
      {!!selectedSpreadsheetForRename && (
        <RenameSpreadsheetDialog
          spreadsheetId={selectedSpreadsheetForRename}
          open={!!selectedSpreadsheetForRename}
          onOpenChange={(open: boolean) => !open && setSelectedSpreadsheetForRename(null)}
        />
      )}
    </SidebarGroup>
  );
}
