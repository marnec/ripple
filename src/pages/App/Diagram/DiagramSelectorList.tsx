import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { ChevronRight, PenTool, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "../../../components/ui/sidebar";
import { DiagramSelectorItem } from "./DiagramSelectorItem";
import { RenameDiagramDialog } from "./RenameDiagramDialog";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

import type { AllFavoriteIds } from "../Document/DocumentSelectorList";

export type DiagramSelectorProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string | null) => void;
  allFavoriteIds: AllFavoriteIds | undefined;
  isOpen: boolean;
  onToggle: () => void;
};

export function DiagramSelectorList({
  workspaceId,
  diagramId,
  onDiagramSelect,
  allFavoriteIds,
  isOpen,
  onToggle,
}: DiagramSelectorProps) {
  const [selectedDiagramForRename, setSelectedDiagramForRename] = useState<Id<"diagrams"> | null>(null);
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/diagrams");

  const diagrams = useWorkspaceSidebar()?.diagrams;
  const createDiagram = useMutation(api.diagrams.create);
  const toggleFavorite = useMutation(api.favorites.toggle);

  const favoriteSet = useMemo(() => new Set(allFavoriteIds?.diagram ?? []), [allFavoriteIds]);
  const favoriteDiagrams = useMemo(
    () => diagrams?.filter((d: { _id: string }) => favoriteSet.has(d._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [diagrams, favoriteSet],
  );

  const handleUnstar = (id: Id<"diagrams">) => {
    void toggleFavorite({ workspaceId, resourceType: "diagram", resourceId: id });
  };

  const navigateToDiagramSettings = (id: Id<"diagrams">) => {
    if (isMobile) setSidebarOpen(false);
    void navigate(`/workspaces/${workspaceId}/diagrams/${id}/settings`);
  };

  const handleCreate = async () => {
    const id = await createDiagram({ workspaceId });
    onDiagramSelect(id);
  };

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "diagram");
    onDiagramSelect(null);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Diagrams" onClick={handleHeaderClick} isActive={isListActive}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <PenTool className="size-4" />
          <span className="font-medium">Diagrams</span>
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
          <Plus />
          <span className="sr-only">New Diagram</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            {favoriteDiagrams?.map((diagram: any, idx: number) => (
              <DiagramSelectorItem
                key={diagram._id}
                idx={idx}
                diagram={diagram}
                diagramId={diagramId}
                onDiagramSelect={onDiagramSelect}
                onRenameDiagram={setSelectedDiagramForRename}
                onManageDiagram={navigateToDiagramSettings}
                onUnstarDiagram={handleUnstar}
              />
            ))}
            <EmptyFavoriteSlots filled={favoriteDiagrams?.length ?? 0} workspaceId={workspaceId} resourceType="diagram" />
          </SidebarMenuSub>
        </CollapsibleContent>
        {!!selectedDiagramForRename && (
          <RenameDiagramDialog
            diagramId={selectedDiagramForRename}
            open={!!selectedDiagramForRename}
            onOpenChange={(open: boolean) => !open && setSelectedDiagramForRename(null)}
          />
        )}
    </Collapsible>
  );
}
