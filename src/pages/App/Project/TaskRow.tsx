import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  statuses?: Array<{ _id: string; name: string; color: string }>;
  onStatusChange?: (statusId: string) => void;
  onClick: () => void;
};

export function TaskRow({ task, statuses, onStatusChange, onClick }: TaskRowProps) {
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

      {/* Status Badge — clickable dropdown for quick status switch */}
      {task.status && statuses && onStatusChange ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
              <span
                className={cn("w-1.5 h-1.5 rounded-full", task.status.color)}
                aria-hidden="true"
              />
              {task.status.name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {statuses.map((s) => (
              <DropdownMenuItem
                key={s._id}
                onClick={() => onStatusChange(s._id)}
                className="flex items-center gap-2"
              >
                <span className={cn("w-2 h-2 rounded-full", s.color)} />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : task.status ? (
        <Badge variant="secondary" className="flex items-center gap-1">
          <span
            className={cn("w-1 h-1 rounded-full", task.status.color)}
            aria-hidden="true"
          />
          {task.status.name}
        </Badge>
      ) : null}

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
