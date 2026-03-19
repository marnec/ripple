import { RippleSpinner } from "@/components/RippleSpinner";
import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { LayoutList, Kanban, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { startViewTransition } from "@/hooks/use-view-transition";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { KanbanBoard } from "./KanbanBoard";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { Tasks } from "./Tasks";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";

export function ProjectTasksPage() {
  const { workspaceId, projectId } = useParams<QueryParams>();

  if (!workspaceId || !projectId) {
    return <SomethingWentWrong />;
  }

  return (
    <ProjectTasksContent
      workspaceId={workspaceId}
      projectId={projectId}
    />
  );
}

function ProjectTasksContent({
  workspaceId,
  projectId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
}) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"list" | "board">(isMobile ? "list" : "board");

  // Force list view on mobile — kanban doesn't work on small screens
  const effectiveView = isMobile ? "list" : view;
  const [dialogOpen, setDialogOpen] = useState(false);

  const [filters, setFilters] = useState<TaskFilters>({
    completionFilter: "uncompleted" as const,
    assigneeIds: [],
    priorities: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [sortBlocked, setSortBlocked] = useState(false);
  const sortBlockedTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSortBlocked = () => {
    setSortBlocked(true);
    if (sortBlockedTimer.current) clearTimeout(sortBlockedTimer.current);
    sortBlockedTimer.current = setTimeout(() => setSortBlocked(false), 2500);
  };

  const setFiltersAnimated = (next: TaskFilters) => startViewTransition(() => setFilters(next));
  const setSortAnimated = (next: TaskSort) => startViewTransition(() => setSort(next));

  // Pre-fetch tasks to show a loading indicator beside the tabs
  const tasks = useQuery(api.tasks.listByProject, { projectId, hideCompleted: false });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useWorkspaceMembers();
  const contentLoading = tasks === undefined || statuses === undefined;

  if (isMobile && contentLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RippleSpinner size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 md:px-6 md:pt-6">
      <Tabs value={effectiveView} onValueChange={(v) => setView(v as "list" | "board")} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {!isMobile && (
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
            )}
            {!isMobile && contentLoading && <RippleSpinner size={24} />}
          </div>
          {!isMobile && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New task
            </Button>
          )}
        </div>

        {isMobile && (
          <HeaderSlot>
            <Button variant="ghost" size="icon" onClick={() => setDialogOpen(true)} aria-label="New task">
              <Plus className="size-4" />
            </Button>
          </HeaderSlot>
        )}

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

        <TabsContent value="list" className="mt-0 overflow-auto animate-fade-in">
          <Tasks projectId={projectId} workspaceId={workspaceId} filters={filters} sort={sort} />
        </TabsContent>
      </Tabs>

      <CreateTaskDialog
        projectId={projectId}
        workspaceId={workspaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
