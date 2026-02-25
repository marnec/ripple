import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTaskId, formatDueDate, formatEstimate, isOverdue } from "@/lib/task-utils";
import { AlertCircle, ArrowDown, ArrowUp, Ban, Minus } from "lucide-react";

type TaskRowProps = {
  task: {
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    completed: boolean;
    number?: number;
    projectKey?: string;
    dueDate?: string;
    estimate?: number;
    hasBlockers?: boolean;
    status: {
      name: string;
      color: string;
    } | null;
    assignee: {
      name?: string;
      image?: string;
    } | null;
  };
  onClick: () => void;
};

export function TaskRow({ task, onClick }: TaskRowProps) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 border-b hover:bg-accent cursor-pointer transition-colors"
    >
      {/* Priority Icon */}
      <div className="flex-shrink-0">
        {task.priority === "urgent" && (
          <AlertCircle className="w-4 h-4 text-red-500" />
        )}
        {task.priority === "high" && (
          <ArrowUp className="w-4 h-4 text-orange-500" />
        )}
        {task.priority === "medium" && (
          <Minus className="w-4 h-4 text-yellow-500" />
        )}
        {task.priority === "low" && (
          <ArrowDown className="w-4 h-4 text-gray-400" />
        )}
      </div>

      {/* Blocked indicator */}
      {task.hasBlockers && (
        <span title="Blocked"><Ban className="w-3 h-3 text-red-500 shrink-0" /></span>
      )}

      {/* Task ID */}
      {formatTaskId(task.projectKey, task.number) && (
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {formatTaskId(task.projectKey, task.number)}
        </span>
      )}

      {/* Title */}
      <div
        className={cn(
          "flex-1 min-w-0 text-sm font-medium truncate",
          task.completed && "line-through text-muted-foreground"
        )}
      >
        {task.title}
      </div>

      {/* Due Date */}
      {task.dueDate && (
        <span className={cn(
          "text-xs shrink-0",
          isOverdue(task.dueDate) ? "text-red-500 font-medium" : "text-muted-foreground"
        )}>
          {formatDueDate(task.dueDate)}
        </span>
      )}

      {/* Estimate */}
      {task.estimate != null && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatEstimate(task.estimate)}
        </span>
      )}

      {/* Status Badge */}
      {task.status && (
        <Badge variant="secondary" className="flex items-center gap-1">
          <span
            className={cn("w-1 h-1 rounded-full", task.status.color)}
            aria-hidden="true"
          />
          {task.status.name}
        </Badge>
      )}

      {/* Assignee Avatar */}
      {task.assignee && (
        <Avatar className="h-6 w-6">
          {task.assignee.image && (
            <AvatarImage src={task.assignee.image} alt={task.assignee.name ?? "Assignee"} />
          )}
          <AvatarFallback className="text-xs">
            {task.assignee.name?.slice(0, 2).toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
