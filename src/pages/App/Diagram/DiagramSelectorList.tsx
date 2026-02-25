import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useMutation, useQuery } from "convex/react";
import { PenTool } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
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
  const createNewDiagram = useMutation(api.diagrams.create);
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

  const handleDiagramCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewDiagram({ workspaceId });
    onDiagramSelect(id);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Diagrams</SidebarGroupLabel>
      <SidebarGroupAction onClick={() => void handleDiagramCreate()} title="Create diagram">
        <PenTool />
        <span className="sr-only">Create diagram</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {diagrams?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No diagrams yet</p>
        )}
        {diagrams?.map((diagram) => (
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
      </SidebarMenu>
      {deleteDialog}
      {!!selectedDiagramForRename && (
        <RenameDiagramDialog
          diagramId={selectedDiagramForRename}
          open={!!selectedDiagramForRename}
          onOpenChange={(open: boolean) => !open && setSelectedDiagramForRename(null)}
        />
      )}
    </SidebarGroup>
  );
} 