import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemActions,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { formatTaskId, formatDueDate, formatEstimate, isOverdue, getPriorityIcon } from "@/lib/task-utils";
import { Ban } from "lucide-react";

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
  /** Hide the status dropdown (e.g. on mobile where swipe handles status). */
  hideStatusMenu?: boolean;
  /** Remove rounded corners so the row sits flush inside a SwipeToReveal wrapper. */
  flush?: boolean;
};

export function TaskRow({ task, statuses, onStatusChange, onClick, hideStatusMenu, flush }: TaskRowProps) {
  const taskId = formatTaskId(task.projectKey, task.number);

  return (
    <Item
      onClick={onClick}
      style={!flush ? {
        viewTransitionName: `--task-${task._id}`,
        viewTransitionClass: "task-card",
      } as React.CSSProperties : undefined}
      className={cn("cursor-pointer hover:bg-accent transition-colors border-input", flush && "rounded-none")}
    >
      <ItemMedia>
        {getPriorityIcon(task.priority)}
        {task.hasBlockers && (
          <span title="Blocked"><Ban className="w-3 h-3 text-red-500" /></span>
        )}
      </ItemMedia>

      <ItemContent>
        <ItemTitle className={cn(task.completed && "line-through text-muted-foreground")}>
          {taskId && (
            <span className="text-xs text-muted-foreground font-mono">{taskId}</span>
          )}
          <span className="truncate">{task.title}</span>
        </ItemTitle>
      </ItemContent>

      <ItemActions>
        {task.dueDate && (
          <span className={cn(
            "text-xs shrink-0",
            isOverdue(task.dueDate) ? "text-red-500 font-medium" : "text-muted-foreground"
          )}>
            {formatDueDate(task.dueDate)}
          </span>
        )}

        {task.estimate != null && (
          <span className="text-xs text-muted-foreground shrink-0">
            {formatEstimate(task.estimate)}
          </span>
        )}

        {task.status ? (
          hideStatusMenu ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground">
              <span
                className={cn("w-1.5 h-1.5 rounded-full", task.status.color)}
                aria-hidden="true"
              />
              {task.status.name}
            </span>
          ) : statuses && onStatusChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                render={<button className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground cursor-pointer hover:bg-muted-foreground/20 transition-colors" />}
              >
                  <span
                    className={cn("w-1.5 h-1.5 rounded-full", task.status.color)}
                    aria-hidden="true"
                  />
                  {task.status.name}
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
          ) : null
        ) : null}

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
      </ItemActions>
    </Item>
  );
}
