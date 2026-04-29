import React, { Suspense, useEffect, useRef, useState } from "react";
import { RippleSpinner } from "@/components/RippleSpinner";
import { ProjectColorTag } from "@/components/ProjectColorTag";
import { SwipeToReveal } from "@/components/SwipeToReveal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { startViewTransition } from "@/hooks/use-view-transition";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { CheckSquare, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { HeaderSlot } from "@/contexts/HeaderSlotContext";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const LazyTaskDetailSheet = React.lazy(() =>
  import("./TaskDetailSheet").then((m) => ({ default: m.TaskDetailSheet })),
);
import { TaskRow } from "./TaskRow";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";
import { useDualAssigneeTasks } from "./useDualAssigneeTasks";

type MyTask = {
  _id: string;
  _creationTime: number;
  title: string;
  priority: "urgent" | "high" | "medium" | "low";
  completed: boolean;
  projectId: Id<"projects">;
  assigneeId?: string;
  dueDate?: string;
  startDate?: string;
  position?: string;
  number?: number;
  projectKey?: string;
  estimate?: number;
  hasBlockers?: boolean;
  statusId: string;
  status: { name: string; color: string } | null;
  assignee: { name?: string; image?: string } | null;
  project: { name: string; color: string } | null;
};

type ProjectGroup = {
  projectId: Id<"projects">;
  projectName: string;
  projectColor: string;
  tasks: MyTask[];
};

// Per-project task list with swipe-to-advance-status, mirroring Tasks.tsx
function ProjectGroupTasks({
  group,
  isMobile,
  swipeOpenId,
  setSwipeOpenId,
  onTaskClick,
}: {
  group: ProjectGroup;
  isMobile: boolean;
  swipeOpenId: string | null;
  setSwipeOpenId: (id: string | null) => void;
  onTaskClick: (taskId: string, projectId: Id<"projects">) => void;
}) {
  const statuses = useQuery(api.taskStatuses.listByProject, { projectId: group.projectId });
  const updateTask = useMutation(api.tasks.update);

  const advanceStatus = (taskId: string, currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      const nextStatus = statuses[(idx + 1) % statuses.length];
      void updateTask({ taskId: taskId as Id<"tasks">, statusId: nextStatus._id as Id<"taskStatuses"> });
      setSwipeOpenId(null);
    };

  const getNextStatus = (currentStatusId: string) => {
      if (!statuses || statuses.length === 0) return null;
      const idx = statuses.findIndex((s) => s._id === currentStatusId);
      return statuses[(idx + 1) % statuses.length];
    };

  return (
    <div className="divide-y divide-border">
      {group.tasks.map((task) => {
        const nextStatus = getNextStatus(task.statusId);
        return (
          <div
            key={task._id}
            style={{
              viewTransitionName: `--task-${task._id}`,
              viewTransitionClass: "task-card",
            } as React.CSSProperties}
          >
            <SwipeToReveal
              enabled={isMobile}
              className="rounded-none"
              open={swipeOpenId === task._id}
              onOpenChange={(open) => setSwipeOpenId(open ? task._id : null)}
              onSwipeStart={() => setSwipeOpenId(null)}
              action={
                nextStatus ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      advanceStatus(task._id, task.statusId);
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center w-full h-full gap-0.5 text-white px-1",
                      nextStatus.color
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
                statuses={isMobile ? undefined : (statuses ?? undefined)}
                hideStatusMenu={isMobile}
                hideAssignee
                flush
                onStatusChange={(statusId) => {
                  void updateTask({
                    taskId: task._id as Id<"tasks">,
                    statusId: statusId as Id<"taskStatuses">,
                  });
                }}
                onClick={() => onTaskClick(task._id, group.projectId)}
              />
            </SwipeToReveal>
          </div>
        );
      })}
    </div>
  );
}

export function MyTasks() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [filters, setFilters] = useState<TaskFilters>({
    completionFilter: "uncompleted",
    assigneeIds: [],
    priorities: [],
    tags: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | null>(null);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const tasks = useDualAssigneeTasks(
    workspaceId ? (workspaceId as Id<"workspaces">) : undefined,
    filters.completionFilter,
  );

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

  const setFiltersAnimated = (next: TaskFilters) => startViewTransition(() => setFilters(next));
  const setSortAnimated = (next: TaskSort) => startViewTransition(() => setSort(next));

  const filteredTasks = useFilteredTasks(tasks, filters, sort);

  const groupedTasks = (() => {
    if (!filteredTasks) return [];
    const groups = new Map<string, ProjectGroup>();
    for (const task of filteredTasks) {
      if (!task.project) continue;
      const key = task.projectId;
      if (!groups.has(key)) {
        groups.set(key, {
          projectId: key,
          projectName: task.project.name,
          projectColor: task.project.color,
          tasks: [],
        });
      }
      groups.get(key)!.tasks.push(task);
    }
    return Array.from(groups.values());
  })();

  const toggleGroup = (projectId: string) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleTaskClick = (taskId: string, projectId: Id<"projects">) => {
      if (isMobile) {
        void navigate(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`);
      } else {
        setSelectedTaskId(taskId);
        setSelectedProjectId(projectId);
      }
    };

  if (tasks === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <RippleSpinner />
      </div>
    );
  }

  const totalTaskCount = filteredTasks?.length ?? 0;

  return (
    <div className="container mx-auto p-4 animate-fade-in">
      {/* Page Header — hidden on mobile to save space */}
      <div className="mb-5 hidden md:block">
        <div className="flex items-center gap-2.5 mb-1">
          <h1 className="text-2xl font-semibold">My Tasks</h1>
          <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 tabular-nums">
            {totalTaskCount}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Tasks assigned to you across all projects
        </p>
      </div>

      {/* Toolbar */}
      <div className="mb-4">
        <TaskToolbar
          workspaceId={workspaceId as Id<"workspaces">}
          filters={filters}
          onFiltersChange={setFiltersAnimated}
          sort={sort}
          onSortChange={setSortAnimated}
          members={[]}
          hideAssigneeFilter
        />
      </div>

      {/* Grouped Task List */}
      {groupedTasks.length === 0 ? (
        <div className="py-16 text-center">
          <CheckSquare className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {tasks.length === 0 ? "No tasks assigned to you" : "No tasks match your filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-3" ref={listRef}>
          {groupedTasks.map((group) => {
            const isOpen = !closedGroups.has(group.projectId);
            return (
              <div
                key={group.projectId}
                style={{
                  viewTransitionName: `--project-group-${group.projectId}`,
                  viewTransitionClass: "task-card",
                } as React.CSSProperties}
              >
                <Collapsible
                  open={isOpen}
                  onOpenChange={() => toggleGroup(group.projectId)}
                >
                  <div className="border rounded-lg overflow-hidden">
                    <CollapsibleTrigger nativeButton className="w-full">
                      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors">
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <ProjectColorTag color={group.projectColor} />
                        <span className="text-sm font-medium text-left flex-1 truncate">
                          {group.projectName}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {group.tasks.length}
                        </span>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div>
                        <ProjectGroupTasks
                          group={group}
                          isMobile={isMobile}
                          swipeOpenId={swipeOpenId}
                          setSwipeOpenId={setSwipeOpenId}
                          onTaskClick={handleTaskClick}
                        />
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}

      {isMobile && (
        <HeaderSlot>
          <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 tabular-nums">
            {totalTaskCount}
          </span>
        </HeaderSlot>
      )}

      {/* Always mounted so the Sheet slide-in animation plays.
          projectId fallback: use any valid project ID so queries don't
          receive "" while the sheet is closed (open={false}). */}
      {workspaceId && (
        <Suspense fallback={null}>
          <LazyTaskDetailSheet
            taskId={selectedTaskId as Id<"tasks"> | null}
            open={!!selectedTaskId}
            onOpenChange={(open) => { if (!open) { setSelectedTaskId(null); } }}
            workspaceId={workspaceId as Id<"workspaces">}
            projectId={selectedProjectId ?? tasks?.[0]?.projectId ?? ("" as Id<"projects">)}
          />
        </Suspense>
      )}
    </div>
  );
}
