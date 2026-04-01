import { memo } from "react";
import { PenTool, Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { preselectSearchTab } from "../Resources/sidebar-constants";

export type DiagramSelectorProps = {
  workspaceId: Id<"workspaces">;
  diagramId: Id<"diagrams"> | undefined;
  onDiagramSelect: (id: string | null) => void;
  diagrams?: { _id: string; name: string; tags?: string[]; _creationTime: number }[];
};

export const DiagramSelectorList = memo(function DiagramSelectorList({
  workspaceId,
  onDiagramSelect,
}: DiagramSelectorProps) {
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/diagrams");

  const createDiagram = useMutation(api.diagrams.create);

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "diagram");
    onDiagramSelect(null);
  };

  const handleCreate = async () => {
    if (isMobile) setSidebarOpen(false);
    const id = await createDiagram({ workspaceId });
    onDiagramSelect(id);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Diagrams" onClick={handleHeaderClick} isActive={isListActive}>
        <PenTool className="size-4" />
        <span className="font-medium">Diagrams</span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
        <Plus />
        <span className="sr-only">New Diagram</span>
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
});
