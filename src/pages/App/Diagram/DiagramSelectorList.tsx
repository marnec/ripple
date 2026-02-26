import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { PenTool } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
import { DiagramSelectorItem } from "./DiagramSelectorItem";
import { RenameDiagramDialog } from "./RenameDiagramDialog";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

export type DiagramSelectorProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string | null) => void;
};

export function DiagramSelectorList({
  workspaceId,
  diagramId,
  onDiagramSelect,
}: DiagramSelectorProps) {
  const [selectedDiagramForRename, setSelectedDiagramForRename] = useState<Id<"diagrams"> | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/diagrams");
  const deletingIdRef = useRef<string | null>(null);

  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "diagram" });

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteDiagrams = useMemo(
    () => diagrams?.filter((d: { _id: string }) => favoriteSet.has(d._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [diagrams, favoriteSet],
  );
  const { requestDelete, dialog: deleteDialog } = useConfirmedDelete("diagram", {
    onDeleted: () => {
      if (deletingIdRef.current && window.location.pathname.includes(deletingIdRef.current)) {
        onDiagramSelect(null);
      }
      deletingIdRef.current = null;
    },
  });

  const handleDiagramDelete = (id: Id<"diagrams">) => {
    deletingIdRef.current = id;
    const diagram = diagrams?.find((d) => d._id === id);
    void requestDelete(id, diagram?.name ?? "Untitled");
  };

  const navigateToDiagramSettings = (id: Id<"diagrams">) => {
    void navigate(`/workspaces/${workspaceId}/diagrams/${id}/settings`);
  };

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "diagram");
    onDiagramSelect(null);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Diagrams" onClick={handleHeaderClick} isActive={isListActive}>
        <PenTool className="size-4" />
        <span className="font-medium">Diagrams</span>
      </SidebarMenuButton>
      <SidebarMenuSub className="gap-0">
        {favoriteDiagrams?.map((diagram: any) => (
          <DiagramSelectorItem
            key={diagram._id}
            diagram={diagram}
            diagramId={diagramId}
            onDiagramSelect={onDiagramSelect}
            onRenameDiagram={setSelectedDiagramForRename}
            onManageDiagram={navigateToDiagramSettings}
            onDeleteDiagram={(id) => handleDiagramDelete(id)}
          />
        ))}
        <EmptyFavoriteSlots filled={favoriteDiagrams?.length ?? 0} workspaceId={workspaceId} resourceType="diagram" />
      </SidebarMenuSub>
      {deleteDialog}
      {!!selectedDiagramForRename && (
        <RenameDiagramDialog
          diagramId={selectedDiagramForRename}
          open={!!selectedDiagramForRename}
          onOpenChange={(open: boolean) => !open && setSelectedDiagramForRename(null)}
        />
      )}
    </SidebarMenuItem>
  );
}
