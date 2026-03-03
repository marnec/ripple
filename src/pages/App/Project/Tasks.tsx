import { SwipeToReveal } from "@/components/SwipeToReveal";
import { useAnimatedQuery, isPositionOnlyChange } from "@/hooks/use-animated-query";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMutation, useQuery } from "convex/react";
import { CheckSquare, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { CreateTaskInline } from "./CreateTaskInline";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { TaskRow } from "./TaskRow";
import type { TaskFilters, TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";

type TasksProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  filters: TaskFilters;
  sort: TaskSort;
};

export function Tasks({ projectId, workspaceId, filters, sort }: TasksProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(
    null
  );
  const sheetOpen = selectedTaskId !== null;
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const liveTasks = useQuery(api.tasks.listByProject, {
    projectId,
    hideCompleted: false,
  });

  const allTasks = useAnimatedQuery(
    liveTasks,
    isPositionOnlyChange,
    sheetOpen,
  );
  const tasks = useFilteredTasks(allTasks, filters, sort);

  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);

  // Track which row has its swipe action revealed (only one at a time)
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const closeAllSwipes = useCallback(() => setSwipeOpenId(null), []);
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

  // Advance task to the next status in column order (wraps around)
  const advanceStatus = useCallback(
    (taskId: string, currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      const nextStatus = statuses[(idx + 1) % statuses.length];
      void updateTask({
        taskId: taskId as Id<"tasks">,
        statusId: nextStatus._id as Id<"taskStatuses">,
      });
      setSwipeOpenId(null);
    },
    [statuses, updateTask],
  );

  // Get next status label for a given task
  const getNextStatus = useCallback(
    (currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return null;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      return statuses[(idx + 1) % statuses.length];
    },
    [statuses],
  );

  if (allTasks === undefined || tasks === undefined) {
    return null;
  }

  const totalCount = allTasks.length;

  return (
    <div>
      {/* Inline Task Creation */}
      <CreateTaskInline projectId={projectId} workspaceId={workspaceId} />

      {/* Task List */}
      {totalCount === 0 ? (
        <div className="py-12 text-center">
          <CheckSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">No tasks yet</h3>
          <p className="text-sm text-muted-foreground">
            Create your first task using the input above
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex flex-col gap-1.5">
          {tasks.map((task) => {
            const nextStatus = getNextStatus(task.statusId);
            return (
              <SwipeToReveal
                key={task._id}
                enabled={isMobile}
                open={swipeOpenId === task._id}
                onOpenChange={(open) => setSwipeOpenId(open ? task._id : null)}
                onSwipeStart={closeAllSwipes}
                action={
                  nextStatus ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        advanceStatus(task._id, task.statusId);
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center w-full h-full gap-0.5 text-white px-1",
                        nextStatus.color,
                      )}
                    >
                      <ArrowRight className="h-4 w-4" />
                      <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
                        {nextStatus.name}
                      </span>
                    </button>
                  ) : null
                }
              >
                <TaskRow
                  task={task}
                  statuses={statuses ?? undefined}
                  hideStatusMenu={isMobile}
                  flush={isMobile}
                  onStatusChange={(statusId) => {
                    void updateTask({ taskId: task._id as Id<"tasks">, statusId: statusId as Id<"taskStatuses"> });
                  }}
                  onClick={() => {
                    if (isMobile) {
                      void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${task._id}`);
                    } else {
                      setSelectedTaskId(task._id as Id<"tasks">);
                    }
                  }}
                />
              </SwipeToReveal>
            );
          })}
        </div>
      )}

      {/* Task Detail Sheet */}
      <TaskDetailSheet
        taskId={selectedTaskId}
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
        workspaceId={workspaceId}
        projectId={projectId}
      />
    </div>
  );
}
