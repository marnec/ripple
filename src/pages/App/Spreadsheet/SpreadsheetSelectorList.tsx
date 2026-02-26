import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
import { SpreadsheetSelectorItem } from "./SpreadsheetSelectorItem";
import { RenameSpreadsheetDialog } from "./RenameSpreadsheetDialog";

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
  const navigate = useNavigate();
  const deletingIdRef = useRef<string | null>(null);

  const spreadsheets = useQuery(api.spreadsheets.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "spreadsheet" });

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

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Spreadsheets">
        <Link to={`/workspaces/${workspaceId}/spreadsheets`} className="font-medium">
          <Table2 className="size-4" />
          Spreadsheets
        </Link>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {favoriteSheets?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No starred spreadsheets</p>
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
      </SidebarMenuSub>
      {deleteDialog}
      {!!selectedSpreadsheetForRename && (
        <RenameSpreadsheetDialog
          spreadsheetId={selectedSpreadsheetForRename}
          open={!!selectedSpreadsheetForRename}
          onOpenChange={(open: boolean) => !open && setSelectedSpreadsheetForRename(null)}
        />
      )}
    </SidebarMenuItem>
  );
}
