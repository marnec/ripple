import { useMutation, useQuery } from "convex/react";
import { PenTool } from "lucide-react";
import { useState } from "react";
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
  
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const createNewDiagram = useMutation(api.diagrams.create);
  const deleteDiagram = useMutation(api.diagrams.remove);

  const handleDiagramDelete = async (id: Id<"diagrams">) => {
    await deleteDiagram({ id });
    onDiagramSelect(null);
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
            onDeleteDiagram={(id) => void handleDiagramDelete(id)}
          />
        ))}
      </SidebarMenu>
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