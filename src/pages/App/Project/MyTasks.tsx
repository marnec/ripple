import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { CheckSquare, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { TaskRow } from "./TaskRow";

type ProjectGroup = {
  projectId: Id<"projects">;
  projectName: string;
  projectColor: string;
  tasks: Array<{
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    completed: boolean;
    projectId: Id<"projects">;
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
    } | null;
    project: {
      name: string;
      color: string;
    };
  }>;
};

export function MyTasks() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [hideCompleted, setHideCompleted] = useState(true);
  const [_selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  const tasks = useQuery(
    api.tasks.listByAssignee,
    workspaceId ? { workspaceId: workspaceId as Id<"workspaces">, hideCompleted } : "skip"
  );

  // Group tasks by project
  const groupedTasks = useMemo(() => {
    if (!tasks) return [];
    const groups = new Map<string, ProjectGroup>();
    for (const task of tasks) {
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
  }, [tasks]);

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
        <LoadingSpinner />
      </div>
    );
  }

  const totalTaskCount = tasks.length;

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">My Tasks</h1>
          <Badge variant="secondary">{totalTaskCount}</Badge>
        </div>
        <p className="text-muted-foreground">
          Tasks assigned to you across all projects
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="hide-completed-my-tasks"
            checked={hideCompleted}
            onCheckedChange={(checked) => setHideCompleted(checked === true)}
          />
          <Label
            htmlFor="hide-completed-my-tasks"
            className="text-sm font-normal cursor-pointer"
          >
            Hide completed
          </Label>
        </div>
      </div>

      {/* Grouped Task List */}
      {groupedTasks.length === 0 ? (
        <div className="py-12 text-center border rounded-lg">
          <CheckSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">No tasks assigned to you</h3>
          <p className="text-sm text-muted-foreground">
            Tasks assigned to you will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTasks.map((group) => {
            const isOpen = !closedGroups.has(group.projectId);
            return (
              <Collapsible
                key={group.projectId}
                open={isOpen}
                onOpenChange={() => toggleGroup(group.projectId)}
              >
                <div className="border rounded-lg overflow-hidden">
                  {/* Project Group Header */}
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 hover:bg-muted transition-colors">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span
                        className={cn("w-2 h-2 rounded-full", group.projectColor)}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-left flex-1">
                        {group.projectName}
                      </span>
                      <Badge variant="secondary">{group.tasks.length}</Badge>
                    </div>
                  </CollapsibleTrigger>

                  {/* Tasks in Group */}
                  <CollapsibleContent>
                    <div>
                      {group.tasks.map((task) => (
                        <TaskRow
                          key={task._id}
                          task={task}
                          onClick={() => {
                            setSelectedTaskId(task._id);
                          }}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* TODO: TaskDetailSheet integration
          Once TaskDetailSheet.tsx is created by plan 02-03, integrate it here.
          When a task is clicked (selectedTaskId is set), render TaskDetailSheet
          with the task's projectId from the task data and the workspace workspaceId.
          The sheet should allow in-place editing without navigating away from My Tasks.
      */}
    </div>
  );
}
