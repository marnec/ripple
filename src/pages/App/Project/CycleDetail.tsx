import { useWorkspaceMembers } from "@/contexts/WorkspaceMembersContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { X } from "lucide-react";
import React, { Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SwipeToReveal } from "@/components/SwipeToReveal";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);
import { TaskRow } from "./TaskRow";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";
import { EditCycleDialog } from "./EditCycleDialog";
import { AddTasksToCycleDialog } from "./AddTasksToCycleDialog";
import { CycleHeader } from "./CycleHeader";

export function CycleDetail() {
  const { workspaceId, projectId, cycleId } = useParams<QueryParams>();

  if (!workspaceId || !projectId || !cycleId) {
    return <SomethingWentWrong />;
  }

  return (
    <CycleDetailContent
      workspaceId={workspaceId}
      projectId={projectId}
      cycleId={cycleId}
    />
  );
}

function CycleDetailContent({
  workspaceId,
  projectId,
  cycleId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"projects">;
  cycleId: Id<"cycles">;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TaskFilters>({
    completionFilter: "uncompleted" as const,
    assigneeIds: [],
    priorities: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const cycle = useQuery(api.cycles.get, { cycleId });
  const cycleTasks = useQuery(api.cycles.listCycleTasks, { cycleId, hideCompleted: false });
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const members = useWorkspaceMembers();
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.cycles.removeTask);

  const filteredTasks = useFilteredTasks(cycleTasks, filters, sort);
  const closeAllSwipes = () => setSwipeOpenId(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close swipe when tapping anywhere outside the task list
  useEffect(() => {
    if (!swipeOpenId) return;
    const onTap = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      setSwipeOpenId(null);
    };
    document.addEventListener("click", onTap, { passive: true });
    return () => document.removeEventListener("click", onTap);
  }, [swipeOpenId]);

  if (cycle === null) {
    return <ResourceDeleted resourceType="cycle" />;
  }

  if (cycle === undefined) {
    return <div className="flex-1 flex flex-col min-h-0"><div className="px-4 py-2.5 md:px-8 border-b"><div className="h-5 w-48" /></div></div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CycleHeader
        cycle={cycle as { name: string; status: string; totalTasks: number; completedTasks: number; progressPercent: number; startDate?: string; dueDate?: string }}
        onEdit={() => setShowEditDialog(true)}
        onAddTasks={() => setShowAddDialog(true)}
      />

      {/* Task toolbar */}
      <div className="px-4 md:px-8 py-2 border-b">
        <TaskToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          members={members ?? []}
          sortBlocked={false}
        />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-3">
        {filteredTasks === undefined ? null : filteredTasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {cycleTasks?.length === 0
              ? "No tasks in this cycle. Add some tasks to get started."
              : "No tasks match the current filters."}
          </div>
        ) : (
          <div ref={listRef} className="flex flex-col gap-1.5">
            {filteredTasks.map((task) => (
              <SwipeToReveal
                key={task._id}
                enabled={isMobile}
                open={swipeOpenId === task._id}
                onOpenChange={(open) => setSwipeOpenId(open ? task._id : null)}
                onSwipeStart={closeAllSwipes}
                action={
                  <button
                    onClick={() =>
                      void removeTask({
                        cycleId,
                        taskId: task._id as Id<"tasks">,
                      })
                    }
                    className="flex items-center justify-center w-full bg-destructive text-destructive-foreground"
                    aria-label="Remove from cycle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                }
              >
                <div className="group flex items-center gap-1">
                  <div className="flex-1 min-w-0">
                    <TaskRow
                      task={task}
                      flush={isMobile}
                      statuses={statuses ?? undefined}
                      onStatusChange={(statusId) => {
                        void updateTask({
                          taskId: task._id as Id<"tasks">,
                          statusId: statusId as Id<"taskStatuses">,
                        });
                      }}
                      onClick={() => {
                        if (isMobile) {
                          void navigate(
                            `/workspaces/${workspaceId}/projects/${projectId}/tasks/${task._id}`
                          );
                        } else {
                          setSelectedTaskId(task._id as Id<"tasks">);
                        }
                      }}
                    />
                  </div>
                  {/* Remove from cycle — desktop hover only */}
                  {!isMobile && (
                    <button
                      onClick={() =>
                        void removeTask({
                          cycleId,
                          taskId: task._id as Id<"tasks">,
                        })
                      }
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded hover:bg-accent"
                      aria-label="Remove from cycle"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </SwipeToReveal>
            ))}
          </div>
        )}
      </div>

      {/* Task detail sheet (desktop) */}
      <Suspense fallback={null}>
        <LazyTaskDetailSheet
          taskId={selectedTaskId}
          open={selectedTaskId !== null}
          onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      </Suspense>

      {/* Add tasks dialog */}
      <AddTasksToCycleDialog
        cycleId={cycleId}
        projectId={projectId}
        existingTaskIds={new Set(cycleTasks?.map((t) => t._id as string) ?? [])}
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
      />

      {/* Edit cycle dialog */}
      {showEditDialog && (
        <EditCycleDialog
          cycle={cycle}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
        />
      )}
    </div>
  );
}
