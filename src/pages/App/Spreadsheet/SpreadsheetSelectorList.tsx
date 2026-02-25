import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useMutation, useQuery } from "convex/react";
import { Table2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
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
  const createNewSpreadsheet = useMutation(api.spreadsheets.create);
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
      <SidebarGroupAction onClick={() => void handleSpreadsheetCreate()} title="Create spreadsheet">
        <Table2 />
        <span className="sr-only">Create spreadsheet</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {spreadsheets?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No spreadsheets yet</p>
        )}
        {spreadsheets?.map((spreadsheet) => (
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
