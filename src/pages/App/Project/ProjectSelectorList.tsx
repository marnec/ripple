import { useQuery } from "convex/react";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
} from "../../../components/ui/sidebar";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectSelectorItem } from "./ProjectSelectorItem";

export interface ProjectSelectorListProps {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  onManageProject: (id: string) => void;
}

export function ProjectSelectorList({
  workspaceId,
  projectId,
  onProjectSelect,
  onManageProject,
}: ProjectSelectorListProps) {
  const [showCreateProject, setShowCreateProject] = useState(false);

  const projects = useQuery(api.projects.listByUserMembership, {
    workspaceId,
  });

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction
        title="Create project"
        onClick={() => setShowCreateProject(true)}
      >
        <FolderPlus />
        <span className="sr-only">Create project</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {projects?.map((project) => (
          <ProjectSelectorItem
            key={project._id}
            project={project}
            projectId={projectId}
            onProjectSelect={onProjectSelect}
            onManageProject={onManageProject}
          />
        ))}
      </SidebarMenu>
      <CreateProjectDialog
        workspaceId={workspaceId}
        open={showCreateProject}
        onOpenChange={setShowCreateProject}
      />
    </SidebarGroup>
  );
}
