import { UserAvatar } from "@/components/UserAvatar";
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
import { TaskCode } from "@/components/TaskCode";
import { cn } from "@/lib/utils";
import { formatDueDate, formatEstimate, isOverdue, getPriorityIcon } from "@/lib/task-utils";
import { ExternalAssigneeAvatars, type ExternalAssignee } from "./ExternalAssignees";
import { Checkbox } from "@/components/ui/checkbox";
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
    externalAssignees?: ExternalAssignee[];
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
  /** Hide the assignee avatar (e.g. on My Tasks where it's always the current user). */
  hideAssignee?: boolean;
  /**
   * Bulk selection. When `onSelectedChange` is set the row shows a checkbox —
   * on hover, or always once any row is selected (`selectionActive`).
   * `shiftKey` lets the list extend a range.
   */
  selected?: boolean;
  selectionActive?: boolean;
  onSelectedChange?: (selected: boolean, shiftKey: boolean) => void;
};

export function TaskRow({ task, statuses, onStatusChange, onClick, hideStatusMenu, flush, hideAssignee, selected, selectionActive, onSelectedChange }: TaskRowProps) {
  return (
    <Item
      onClick={(e) => {
        // While selecting, a row click extends the selection instead of opening the task.
        if (onSelectedChange && selectionActive) {
          onSelectedChange(!selected, e.shiftKey);
          return;
        }
        onClick();
      }}
      className={cn(
        "group/row cursor-pointer hover:bg-accent transition-colors",
        flush ? "rounded-none border-transparent!" : "border-transparent! md:border-input!",
        selected && "bg-accent/60",
      )}
    >
      <ItemMedia>
        {onSelectedChange && (
          <span
            className={cn(
              "flex transition-opacity",
              selectionActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected ?? false}
              aria-label={`Select ${task.title}`}
              onCheckedChange={(checked, details) =>
                onSelectedChange(checked, (details.event as MouseEvent | KeyboardEvent).shiftKey)
              }
            />
          </span>
        )}
        {getPriorityIcon(task.priority)}
        {task.hasBlockers && (
          <span title="Blocked"><Ban className="w-3 h-3 text-red-500" /></span>
        )}
      </ItemMedia>

      <ItemContent className="md:flex-1 md:min-w-0 basis-full md:basis-auto order-last md:order-0 pl-6.5 md:pl-0">
        <ItemTitle className={cn(task.completed && "line-through text-muted-foreground")}>
          <TaskCode task={task} className="shrink-0 hidden md:inline" />
          <span className="truncate">{task.title}</span>
        </ItemTitle>
      </ItemContent>

      {/* Top-row metadata on mobile: task ID + spacer to push actions right */}
      <TaskCode task={task} className="shrink-0 md:hidden" />
      <span className="flex-1 md:hidden" />

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
          <span className="text-xs text-muted-foreground shrink-0 hidden md:inline">
            {formatEstimate(task.estimate)}
          </span>
        )}

        {task.status ? (
          !hideStatusMenu && statuses && onStatusChange ? (
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
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground">
              <span
                className={cn("w-1.5 h-1.5 rounded-full", task.status.color)}
                aria-hidden="true"
              />
              {task.status.name}
            </span>
          )
        ) : null}

        {!hideAssignee && (
          <ExternalAssigneeAvatars assignees={task.externalAssignees} side="left" />
        )}

        {!hideAssignee && task.assignee && (
          <UserAvatar
            className="h-6 w-6"
            name={task.assignee.name}
            image={task.assignee.image}
            alt={task.assignee.name ?? "Assignee"}
            fallbackClassName="text-xs"
          />
        )}
      </ItemActions>
    </Item>
  );
}
