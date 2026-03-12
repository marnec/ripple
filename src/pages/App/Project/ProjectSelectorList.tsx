import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ChevronRight, Folder, Plus } from "lucide-react";
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
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ProjectSelectorItem } from "./ProjectSelectorItem";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

import type { AllFavoriteIds } from "../Document/DocumentSelectorList";

export interface ProjectSelectorListProps {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects"> | undefined;
  onProjectSelect: (id: string | null) => void;
  allFavoriteIds: AllFavoriteIds | undefined;
  isOpen: boolean;
  onToggle: () => void;
}

export function ProjectSelectorList({
  workspaceId,
  projectId,
  onProjectSelect,
  allFavoriteIds,
  isOpen,
  onToggle,
}: ProjectSelectorListProps) {
  const [showCreateProject, setShowCreateProject] = useState(false);
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/projects");
  const toggleFavorite = useMutation(api.favorites.toggle);

  const projects = useQuery(api.projects.list, {
    workspaceId,
  });

  const favoriteSet = useMemo(() => new Set(allFavoriteIds?.project ?? []), [allFavoriteIds]);
  const favoriteProjects = useMemo(
    () => projects?.filter((p) => favoriteSet.has(p._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [projects, favoriteSet],
  );

  const handleUnstar = (id: Id<"projects">) => {
    void toggleFavorite({ workspaceId, resourceType: "project", resourceId: id });
  };

  const navigateToProjectSettings = (id: Id<"projects">) => {
    if (isMobile) setSidebarOpen(false);
    void navigate(`/workspaces/${workspaceId}/projects/${id}/settings`);
  };

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "project");
    onProjectSelect(null);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Projects" onClick={handleHeaderClick} isActive={isListActive}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <Folder className="size-4" />
          <span className="font-medium">Projects</span>
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={() => setShowCreateProject(true)}>
          <Plus />
          <span className="sr-only">New Project</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            {favoriteProjects?.map((project) => (
              <ProjectSelectorItem
                key={project._id}
                project={project}
                projectId={projectId}
                onProjectSelect={onProjectSelect}
                onManageProject={navigateToProjectSettings}
                onUnstarProject={handleUnstar}
              />
            ))}
            <EmptyFavoriteSlots filled={favoriteProjects?.length ?? 0} workspaceId={workspaceId} resourceType="project" />
          </SidebarMenuSub>
        </CollapsibleContent>
        <CreateProjectDialog
          workspaceId={workspaceId}
          open={showCreateProject}
          onOpenChange={setShowCreateProject}
        />
    </Collapsible>
  );
}
