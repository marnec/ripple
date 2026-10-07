import React, { Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { SwipeToReveal } from "@/components/SwipeToReveal";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLongPress } from "@/hooks/use-long-press";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { CheckSquare, ArrowRight, CircleDashed } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);
import { TaskRow } from "./TaskRow";
import { TaskBulkActionBar } from "./TaskBulkActionBar";
import type { TaskFilters, TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";
import { scopeCycleArg, type TaskScope } from "./taskScope";
import { useTaskSelection } from "./useTaskSelection";
import { groupTasksByAssignee, type TaskGroupBy } from "./groupTasks";
import { UserAvatar } from "@/components/UserAvatar";

type TasksProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  filters: TaskFilters;
  sort: TaskSort;
  scope: TaskScope;
  groupBy?: TaskGroupBy | null;
};

export function Tasks({ projectId, workspaceId, filters, sort, scope, groupBy }: TasksProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(
    null
  );
  const sheetOpen = selectedTaskId !== null;
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // One cycle's tasks, or the backlog's — never the whole project. The
  // completion filter picks the half; assignee/priority/tag/sort apply
  // client-side below.
  const liveTasks = useQuery(api.tasks.listByProject, {
    projectId,
    completed: filters.completionFilter === "completed",
    cycleId: scopeCycleArg(scope),
  });

  // Track which row has its swipe action revealed (only one at a time)
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);

  // Hold the last loaded list while a query reloads (e.g. switching to the
  // completed view, whose first page loads asynchronously) so rows persist
  // and animate via motion instead of flashing through the empty state.
  // setState-during-render is React's derived-state pattern; the Object.is
  // guard prevents a loop, and an undefined `liveTasks` is intentionally not
  // written so the previous list stays visible until fresh data arrives.
  const [allTasks, setAllTasks] = useState(liveTasks);
  if (liveTasks !== undefined && !Object.is(liveTasks, allTasks)) {
    setAllTasks(liveTasks);
  }
  const tasks = useFilteredTasks(allTasks, filters, sort);
  const groups = groupBy === "assignee" && tasks ? groupTasksByAssignee(tasks) : null;

  // Selection ranges follow the rendered order, so shift-click spans what
  // you see between the two rows — across group headers when grouped.
  const selection = useTaskSelection(groups ? groups.flatMap((g) => g.tasks) : tasks);

  // Mobile has no hover or shift-click: a long-press selects the row and turns
  // selection mode on, after which a tap toggles (TaskRow's own click path).
  const longPress = useLongPress((taskId: Id<"tasks">) => {
    setSwipeOpenId(null);
    selection.toggle(taskId, true, false);
  });

  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);
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

  // Advance task to the next status in column order (wraps around)
  const advanceStatus = (taskId: string, currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      const nextStatus = statuses[(idx + 1) % statuses.length];
      void updateTask({
        taskId: taskId as Id<"tasks">,
        statusId: nextStatus._id,
      });
      setSwipeOpenId(null);
    };

  // Get next status label for a given task
  const getNextStatus = (currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return null;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      return statuses[(idx + 1) % statuses.length];
    };

  type ListTask = NonNullable<typeof tasks>[number];
  const renderTask = (task: ListTask) => {
    const nextStatus = getNextStatus(task.statusId);
    return (
      <m.div
        key={task._id}
        {...(isMobile ? longPress(task._id) : {})}
        // No text selection or iOS callout on the hold.
        className={cn(isMobile && "select-none [-webkit-touch-callout:none]")}
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <SwipeToReveal
          // A swipe would fight the taps that toggle rows.
          enabled={isMobile && !selection.active}
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
            // Flush only inside the swipe wrapper, which rounds the
            // corners itself; with swipe off for selection the row
            // keeps them.
            flush={isMobile && !selection.active}
            assignable
            selected={selection.isSelected(task._id)}
            selectionActive={selection.active}
            touchSelection={isMobile}
            onSelectedChange={(selected, shiftKey) => selection.toggle(task._id, selected, shiftKey)}
            onStatusChange={(statusId) => {
              void updateTask({ taskId: task._id, statusId: statusId as Id<"taskStatuses"> });
            }}
            onClick={() => {
              if (isMobile) {
                void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${task._id}`);
              } else {
                setSelectedTaskId(task._id);
              }
            }}
          />
        </SwipeToReveal>
      </m.div>
    );
  };

  if (allTasks === undefined || tasks === undefined) {
    return null;
  }

  const totalCount = allTasks.length;


  return (
    <div>
      {/* Task List */}
      {totalCount === 0 ? (
        <div className="py-12 text-center">
          <CheckSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">
            {scope.kind === "backlog" ? "The backlog is empty" : "No tasks yet"}
          </h3>
          <p className="text-sm text-muted-foreground">
            Use the New task button to get started
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {groups
              ? groups.flatMap((group) => [
                  <m.div
                    key={`group:${group.assigneeId ?? "unassigned"}`}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-2 px-1 pt-3 pb-0.5 first:pt-0 text-xs font-medium text-muted-foreground"
                  >
                    {group.assignee ? (
                      <UserAvatar
                        name={group.assignee.name}
                        image={group.assignee.image}
                        className="size-5"
                        fallbackClassName="text-[9px]"
                      />
                    ) : (
                      <CircleDashed className="size-5" />
                    )}
                    <span className="truncate text-foreground">
                      {group.assignee ? (group.assignee.name ?? "Unknown") : "Unassigned"}
                    </span>
                    <span className="tabular-nums">{group.tasks.length}</span>
                  </m.div>,
                  ...group.tasks.map(renderTask),
                ])
              : tasks.map(renderTask)}
          </AnimatePresence>
          {selection.active && (
            <TaskBulkActionBar
              projectId={projectId}
              workspaceId={workspaceId}
              currentCycleId={scope.kind === "cycle" ? scope.cycleId : null}
              selected={selection.selectedTasks}
              visibleCount={tasks.length}
              onSelectAll={selection.selectAll}
              onClear={selection.clear}
            />
          )}
        </div>
      )}

      {/* Task Detail Sheet */}
      <Suspense fallback={null}>
        <LazyTaskDetailSheet
          taskId={selectedTaskId}
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          workspaceId={workspaceId}
          projectId={projectId}
        />
      </Suspense>
    </div>
  );
}
