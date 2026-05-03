import { memo, useState } from "react";
import { Folder, Plus } from "lucide-react";
import { useLocation } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../../../components/ui/sidebar";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { preselectSearchTab } from "../Resources/sidebar-constants";

export interface ProjectSelectorListProps {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  projects?: { _id: string; name: string; color: string; key?: string; _creationTime: number }[];
}

export const ProjectSelectorList = memo(function ProjectSelectorList({
  workspaceId,
  onProjectSelect,
}: ProjectSelectorListProps) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/projects");

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "project");
    onProjectSelect(null);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Projects" onClick={handleHeaderClick} isActive={isListActive}>
        <Folder className="size-4" />
        <span className="font-medium">Projects</span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={() => setShowCreateProject(true)}>
        <Plus />
        <span className="sr-only">New Project</span>
      </SidebarMenuAction>
      <CreateProjectDialog
        workspaceId={workspaceId}
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
      />
    </SidebarMenuItem>
  );
});
