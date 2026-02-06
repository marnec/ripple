import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useQuery } from "convex/react";
import { CheckSquare } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { CreateTaskInline } from "./CreateTaskInline";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { TaskRow } from "./TaskRow";

type TasksProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
};

export function Tasks({ projectId, workspaceId }: TasksProps) {
  const [hideCompleted, setHideCompleted] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(
    null
  );
  const sheetOpen = selectedTaskId !== null;

  const tasks = useQuery(api.tasks.listByProject, {
    projectId,
    hideCompleted,
  });

  if (tasks === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Tasks</h2>
          <Badge variant="secondary">{tasks.length}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="hide-completed"
            checked={hideCompleted}
            onCheckedChange={(checked) =>
              setHideCompleted(checked === true)
            }
          />
          <Label
            htmlFor="hide-completed"
            className="text-sm font-normal cursor-pointer"
          >
            Hide completed
          </Label>
        </div>
      </div>

      {/* Inline Task Creation */}
      <CreateTaskInline projectId={projectId} />

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className="py-12 text-center">
          <CheckSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-medium mb-1">No tasks yet</h3>
          <p className="text-sm text-muted-foreground">
            Create your first task using the input above
          </p>
        </div>
      ) : (
        <div>
          {tasks.map((task) => (
            <TaskRow
              key={task._id}
              task={task}
              onClick={() => {
                setSelectedTaskId(task._id);
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
