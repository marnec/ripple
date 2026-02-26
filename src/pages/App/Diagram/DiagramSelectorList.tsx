import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { PenTool } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
import { DiagramSelectorItem } from "./DiagramSelectorItem";
import { RenameDiagramDialog } from "./RenameDiagramDialog";

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
  const deletingIdRef = useRef<string | null>(null);

  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "diagram" });

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteDiagrams = useMemo(
    () => diagrams?.filter((d: { _id: string }) => favoriteSet.has(d._id)),
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

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Diagrams">
        <Link to={`/workspaces/${workspaceId}/diagrams`} className="font-medium">
          <PenTool className="size-4" />
          Diagrams
        </Link>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {favoriteDiagrams?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No starred diagrams</p>
        )}
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
