import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTaskId, formatDueDate, formatEstimate, isOverdue } from "@/lib/task-utils";
import { AlertCircle, ArrowDown, ArrowUp, Ban, CalendarIcon, Minus } from "lucide-react";

type KanbanCardPresenterProps = {
  task: {
    _id: string;
    title: string;
    priority: "urgent" | "high" | "medium" | "low";
    labels?: string[];
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
  isDragging?: boolean;
};

export function KanbanCardPresenter({
  task,
  onClick,
  isDragging = false,
}: KanbanCardPresenterProps) {
  return (
    <Card
      onClick={onClick}
      style={{
        // DragOverlay renders a second KanbanCardPresenter with isDragging —
        // exclude it from view transitions to avoid duplicate names.
        viewTransitionName: isDragging ? "none" : `--task-${task._id}`,
        viewTransitionClass: isDragging ? undefined : "task-card",
      } as React.CSSProperties}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "shadow-lg rotate-2"
      )}
    >
      <CardHeader className="py-2 px-3">
        <div className="flex items-center gap-1.5 min-h-4">
          {task.hasBlockers && (
            <span title="Blocked"><Ban className="h-3 w-3 text-red-500 shrink-0" /></span>
          )}
          {formatTaskId(task.projectKey, task.number) ? (
            <span className="text-xs text-muted-foreground font-mono">
              {formatTaskId(task.projectKey, task.number)}
            </span>
          ) : (
            <span className="text-xs invisible" aria-hidden>&#8203;</span>
          )}
        </div>
        <h3 className="text-sm font-medium truncate">{task.title}</h3>
      </CardHeader>
      <CardContent className="py-2 px-3 pt-0">
        <div className="flex items-center justify-between mb-2">
          {/* Priority Icon */}
          <div className="shrink-0">
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

          {/* Assignee Avatar — ghost placeholder keeps row height stable */}
          {task.assignee ? (
            <Avatar className="h-6 w-6">
              {task.assignee.image && (
                <AvatarImage src={task.assignee.image} alt={task.assignee.name ?? "Assignee"} />
              )}
              <AvatarFallback className="text-xs">
                {task.assignee.name?.slice(0, 2).toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="h-6 w-6" aria-hidden />
          )}
        </div>

        {/* Labels — always reserve single row height */}
        <div className="flex flex-wrap gap-1 overflow-hidden max-h-5">
          {task.labels && task.labels.length > 0 ? (
            task.labels.map((label, index) => (
              <Badge key={index} variant="secondary" className="text-xs py-0">
                {label}
              </Badge>
            ))
          ) : (
            <span className="text-xs invisible py-0" aria-hidden>&#8203;</span>
          )}
        </div>

        {/* Due date & Estimate — ghost placeholder keeps card height stable */}
        <div className="flex items-center gap-2 mt-1">
          {task.dueDate ? (
            <span className={cn(
              "flex items-center gap-1 text-xs",
              isOverdue(task.dueDate) ? "text-red-500 font-medium" : "text-muted-foreground"
            )}>
              <CalendarIcon className="h-3 w-3" />
              {formatDueDate(task.dueDate)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs invisible" aria-hidden>
              <CalendarIcon className="h-3 w-3" />
              &#8203;
            </span>
          )}
          {task.estimate != null && (
            <span className="text-xs text-muted-foreground">
              {formatEstimate(task.estimate)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
