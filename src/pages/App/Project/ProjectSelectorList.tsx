import { useMutation, useQuery } from "convex/react";
import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
}

export function ProjectSelectorList({
  workspaceId,
  projectId,
  onProjectSelect,
}: ProjectSelectorListProps) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const navigate = useNavigate();
  const deleteProject = useMutation(api.projects.remove);

  const projects = useQuery(api.projects.listByUserMembership, {
    workspaceId,
  });

  const handleProjectDelete = async (id: Id<"projects">) => {
    onProjectSelect(null);
    await deleteProject({ id });
  };

  const navigateToProjectSettings = (id: Id<"projects">) => {
    void navigate(`/workspaces/${workspaceId}/projects/${id}/settings`);
  };

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
        {projects?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet</p>
        )}
        {projects?.map((project) => (
          <ProjectSelectorItem
            key={project._id}
            project={project}
            projectId={projectId}
            onProjectSelect={onProjectSelect}
            onManageProject={navigateToProjectSettings}
            onDeleteProject={(id) => void handleProjectDelete(id)}
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
