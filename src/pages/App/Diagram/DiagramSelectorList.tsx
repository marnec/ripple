import { useConfirmedDelete } from "@/hooks/useConfirmedDelete";
import { useMutation, useQuery } from "convex/react";
import { PenTool, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
import { DiagramSelectorItem } from "./DiagramSelectorItem";
import { RenameDiagramDialog } from "./RenameDiagramDialog";
import { SidebarSearchInput } from "../Sidebar/SidebarSearchInput";

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
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const deletingIdRef = useRef<string | null>(null);

  // @ts-expect-error TS2589 deep type instantiation with Convex query
  const diagrams = useQuery(api.diagrams.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "diagram" });
  const createNewDiagram = useMutation(api.diagrams.create);

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

  const handleDiagramCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewDiagram({ workspaceId });
    onDiagramSelect(id);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Diagrams</SidebarGroupLabel>
      <div className="absolute right-3 top-3.5 flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
        <button onClick={() => setShowSearch((s) => !s)} title="Search diagrams" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <Search />
        </button>
        <button onClick={() => void handleDiagramCreate()} title="Create diagram" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <PenTool />
        </button>
      </div>
      {showSearch && (
        <SidebarSearchInput
          workspaceId={workspaceId}
          resourceRoute="diagrams"
          onClose={() => setShowSearch(false)}
        />
      )}
      <SidebarMenu>
        {favoriteDiagrams?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No starred diagrams</p>
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