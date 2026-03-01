import { FavoriteButton } from "@/components/FavoriteButton";
import { RippleSpinner } from "@/components/RippleSpinner";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { LayoutList, Kanban } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { startViewTransition } from "@/hooks/use-view-transition";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { KanbanBoard } from "./KanbanBoard";
import { Tasks } from "./Tasks";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";

export function ProjectDetails() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectDetailsContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectDetailsContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"list" | "board">(isMobile ? "list" : "board");
  const [filters, setFilters] = useState<TaskFilters>({
    hideCompleted: true,
    assigneeIds: [],
    priorities: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [sortBlocked, setSortBlocked] = useState(false);
  const sortBlockedTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSortBlocked = useCallback(() => {
    setSortBlocked(true);
    if (sortBlockedTimer.current) clearTimeout(sortBlockedTimer.current);
    sortBlockedTimer.current = setTimeout(() => setSortBlocked(false), 2500);
  }, []);

  const setFiltersAnimated = useCallback(
    (next: TaskFilters) => startViewTransition(() => setFilters(next)),
    []
  );
  const setSortAnimated = useCallback(
    (next: TaskSort) => startViewTransition(() => setSort(next)),
    []
  );
  const project = useQuery(api.projects.get, { id: projectId });
  // Pre-fetch tasks to show a loading indicator beside the tabs
  const tasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const contentLoading = tasks === undefined || statuses === undefined;

  if (project === null) {
    return <SomethingWentWrong />;
  }

  // Show layout immediately — header skeleton while project loads, content fades in
  const isLoading = project === undefined;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Project Header — always rendered */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex h-8 items-center gap-2">
          <FavoriteButton
            resourceType="project"
            resourceId={projectId}
            workspaceId={workspaceId}
          />
          {isLoading ? (
            <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          ) : (
            <>
              <h1 className="text-lg font-semibold truncate">{project.name}</h1>
              {project.color && (
                <span className={`w-2.5 h-2.5 rounded-full ${project.color} ml-1`} />
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 md:px-6 md:pt-6">
      {!isLoading && project.description && (
        <p className="text-muted-foreground mb-6">{project.description}</p>
      )}

      {/* View Toggle and Content — tabs always visible */}
      <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="board" className="flex items-center gap-2">
                <Kanban className="h-4 w-4" />
                Board
              </TabsTrigger>
              <TabsTrigger value="list" className="flex items-center gap-2">
                <LayoutList className="h-4 w-4" />
                List
              </TabsTrigger>
            </TabsList>
            {contentLoading && <RippleSpinner size={24} />}
          </div>
        </div>

        {/* Shared toolbar — stable across views */}
        <TaskToolbar
          filters={filters}
          onFiltersChange={setFiltersAnimated}
          sort={sort}
          onSortChange={setSortAnimated}
          members={members ?? []}
          sortBlocked={sortBlocked}
        />

        <TabsContent value="board" className="mt-0 flex-1 flex flex-col min-h-0">
          <KanbanBoard projectId={projectId} workspaceId={workspaceId} filters={filters} sort={sort} onSortBlocked={handleSortBlocked} />
        </TabsContent>

        <TabsContent value="list" className="mt-0 overflow-auto">
          <Tasks projectId={projectId} workspaceId={workspaceId} filters={filters} sort={sort} />
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
