import { RippleSpinner } from "@/components/RippleSpinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { startViewTransition } from "@/hooks/use-view-transition";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { CheckSquare, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { TaskRow } from "./TaskRow";
import { TaskToolbar, type TaskFilters, type TaskSort } from "./TaskToolbar";
import { useFilteredTasks } from "./useTaskFilters";

type ProjectGroup = {
  projectId: Id<"projects">;
  projectName: string;
  projectColor: string;
  tasks: Array<{
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
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
      image?: string;
    } | null;
    project: {
      name: string;
      color: string;
    } | null;
  }>;
};

export function MyTasks() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [filters, setFilters] = useState<TaskFilters>({
    completionFilter: "uncompleted",
    assigneeIds: [],
    priorities: [],
  });
  const [sort, setSort] = useState<TaskSort>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const tasks = useQuery(
    api.tasks.listByAssignee,
    workspaceId ? { workspaceId: workspaceId as Id<"workspaces">, hideCompleted: false } : "skip"
  );

  const setFiltersAnimated = useCallback(
    (next: TaskFilters) => startViewTransition(() => setFilters(next)),
    []
  );
  const setSortAnimated = useCallback(
    (next: TaskSort) => startViewTransition(() => setSort(next)),
    []
  );

  const filteredTasks = useFilteredTasks(tasks, filters, sort);

  // Group filtered tasks by project
  const groupedTasks = useMemo(() => {
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
  }, [filteredTasks]);

  const toggleGroup = (projectId: string) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
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
    <div className="container mx-auto p-4 md:p-6 max-w-5xl">
      {/* Page Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <h1 className="text-xl font-semibold tracking-tight">My Tasks</h1>
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
        <div className="space-y-3">
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
                  {/* Project Group Header */}
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors">
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span
                        className={cn("w-2 h-2 rounded-full shrink-0", group.projectColor)}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-left flex-1 truncate">
                        {group.projectName}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {group.tasks.length}
                      </span>
                    </div>
                  </CollapsibleTrigger>

                  {/* Tasks in Group */}
                  <CollapsibleContent>
                    <div>
                      {group.tasks.map((task) => (
                        <div
                          key={task._id}
                          style={{
                            viewTransitionName: `--task-${task._id}`,
                            viewTransitionClass: "task-card",
                          } as React.CSSProperties}
                        >
                          <TaskRow
                            task={task}
                            flush
                            onClick={() => {
                              if (isMobile) {
                                void navigate(`/workspaces/${workspaceId}/projects/${group.projectId}/tasks/${task._id}`);
                              } else {
                                setSelectedTaskId(task._id);
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
              </div>
            );
          })}
        </div>
      )}

      {selectedTaskId && workspaceId && (() => {
        const selectedTask = tasks?.find((t) => t._id === selectedTaskId);
        if (!selectedTask) return null;
        return (
          <TaskDetailSheet
            taskId={selectedTaskId as Id<"tasks">}
            open={true}
            onOpenChange={(open) => { if (!open) setSelectedTaskId(null); }}
            workspaceId={workspaceId as Id<"workspaces">}
            projectId={selectedTask.projectId}
          />
        );
      })()}
    </div>
  );
}
