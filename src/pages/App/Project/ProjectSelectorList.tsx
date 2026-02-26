import { useMutation, useQuery } from "convex/react";
import { FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from "../../../components/ui/sidebar";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectSelectorItem } from "./ProjectSelectorItem";
import { SidebarSearchInput } from "../Sidebar/SidebarSearchInput";

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
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const deleteProject = useMutation(api.projects.remove);

  const projects = useQuery(api.projects.list, {
    workspaceId,
  });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "project" });

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteProjects = useMemo(
    () => projects?.filter((p) => favoriteSet.has(p._id)),
    [projects, favoriteSet],
  );

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
      <div className="absolute right-3 top-3.5 flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
        <button onClick={() => setShowSearch((s) => !s)} title="Search projects" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <Search />
        </button>
        <button onClick={() => setShowCreateProject(true)} title="Create project" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <FolderPlus />
        </button>
      </div>
      {showSearch && (
        <SidebarSearchInput
          workspaceId={workspaceId}
          resourceRoute="projects"
          onClose={() => setShowSearch(false)}
        />
      )}
      <SidebarMenu>
        {favoriteProjects?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No starred projects</p>
        )}
        {favoriteProjects?.map((project) => (
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
