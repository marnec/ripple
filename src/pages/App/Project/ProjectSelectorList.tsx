import { useMutation, useQuery } from "convex/react";
import { useMemo } from "react";
import { Folder } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
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
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip="Projects">
        <Link to={`/workspaces/${workspaceId}/projects`} className="font-medium">
          <Folder className="size-4" />
          Projects
        </Link>
      </SidebarMenuButton>
      <SidebarMenuSub>
        {favoriteProjects?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No starred projects</p>
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
      </SidebarMenuSub>
    </SidebarMenuItem>
  );
}
