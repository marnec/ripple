import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import { Folder } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
import { ProjectSelectorItem } from "./ProjectSelectorItem";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

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
  const navigate = useNavigate();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/projects");
  const deleteProject = useMutation(api.projects.remove);

  const projects = useQuery(api.projects.list, {
    workspaceId,
  });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "project" });

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteProjects = useMemo(
    () => projects?.filter((p) => favoriteSet.has(p._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [projects, favoriteSet],
  );

  const handleProjectDelete = async (id: Id<"projects">) => {
    onProjectSelect(null);
    await deleteProject({ id });
  };

  const navigateToProjectSettings = (id: Id<"projects">) => {
    void navigate(`/workspaces/${workspaceId}/projects/${id}/settings`);
  };

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
      <SidebarMenuSub className="gap-0">
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
        <EmptyFavoriteSlots filled={favoriteProjects?.length ?? 0} workspaceId={workspaceId} resourceType="project" />
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}
