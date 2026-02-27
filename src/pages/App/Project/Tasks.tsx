import { useIsMobile } from "@/hooks/use-mobile";
import { useMutation, useQuery } from "convex/react";
import { CheckSquare } from "lucide-react";
import { useState } from "react";
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

  const allTasks = useQuery(api.tasks.listByProject, {
    projectId,
    hideCompleted: false,
  });

  const tasks = useFilteredTasks(allTasks, filters, sort);

  const statuses = useQuery(api.taskStatuses.listByProject, { projectId });
  const updateTask = useMutation(api.tasks.update);

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
        <div className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <TaskRow
              key={task._id}
              task={task}
              statuses={statuses ?? undefined}
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
          ))}
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
