import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@ripple/ui/components/badge";
import { Card, CardContent, CardHeader } from "@ripple/ui/components/card";
import { TaskCode } from "@/components/TaskCode";
import { TaskIssueRef } from "./TaskIssueRef";
import { cn } from "@/lib/utils";
import { formatDueDate, formatEstimate, isOverdue, getPriorityIcon } from "@/lib/task-utils";
import { ExternalAssigneeAvatars } from "./ExternalAssignees";
import { KanbanAssigneePicker } from "./KanbanAssigneePicker";
import type { KanbanTask } from "./kanban-types";
import {
  Ban,
  CalendarIcon,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ripple/ui/components/tooltip";

const PR_STATE_META: Record<
  "draft" | "open" | "merged" | "closed",
  { icon: LucideIcon; label: string; className: string }
> = {
  draft: { icon: GitPullRequestDraft, label: "Draft PR", className: "text-white" },
  open: { icon: GitPullRequest, label: "Open PR", className: "text-white" },
  merged: { icon: GitMerge, label: "Merged PR", className: "text-white" },
  closed: { icon: GitPullRequestClosed, label: "Closed PR", className: "text-white" },
};

type KanbanCardPresenterProps = {
  task: KanbanTask;
  onClick: () => void;
  isDragging?: boolean;
  /**
   * False for the copies that aren't the live card — the drag overlay, the
   * cross-column flying ghost, the invisible drag placeholder. They render the
   * assignee as a flat avatar so no popover is mounted four times per card.
   */
  interactive?: boolean;
};

export function KanbanCardPresenter({
  task,
  onClick,
  isDragging = false,
  interactive = true,
}: KanbanCardPresenterProps) {
  const hasExternalAssignees = (task.externalAssignees?.length ?? 0) > 0;

  // Titles are truncated to one line, so hovering reveals the full text — but
  // only when there is something hidden. Vetoing the open (rather than not
  // rendering the tooltip) keeps base-ui's own hover/focus timing.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleTooltipOpen, setTitleTooltipOpen] = useState(false);

  return (
    <Card
      onClick={onClick}
      className={cn(
        "relative cursor-grab active:cursor-grabbing py-0 gap-0 border shadow ring-0 dark:bg-stone-950 bg-stone-100",
        isDragging && "shadow-lg rotate-2"
      )}
    >
      {/* Relation indicator (blocked, …) — pinned to the top-right corner */}
      {task.hasBlockers && (
        <span
          title="Blocked"
          className="absolute top-2 right-3 z-10"
        >
          <Ban className="h-3 w-3 text-red-500 shrink-0" />
        </span>
      )}
      <CardHeader className="py-2 px-3">
        <div className="flex items-center gap-1.5 min-h-4">
          <TaskCode
            task={task}
            fallback={
              <span className="text-xs invisible" aria-hidden>
                &#8203;
              </span>
            }
          />
          {/* Linked GitHub issue: same chip as the task-detail surfaces. It
              carries the strike-through "deleted upstream" state, so the card
              uses one visual language instead of a separate unlink icon. */}
          <TaskIssueRef
            repoFullName={task.externalRefs?.[0]?.repoFullName}
            issueNumber={task.externalRefs?.[0]?.issueNumber}
            url={task.externalRefs?.[0]?.url}
            deleted={task.externalRefs?.[0]?.deleted}
            provider={task.externalRefs?.[0]?.provider}
          />
        </div>
        <Tooltip
          open={titleTooltipOpen}
          onOpenChange={(open) => {
            const el = titleRef.current;
            setTitleTooltipOpen(
              open && !!el && el.scrollWidth > el.clientWidth,
            );
          }}
        >
          <TooltipTrigger
            render={
              <h3 ref={titleRef} className="text-sm font-medium truncate" />
            }
          >
            {task.title}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-left">
            {task.title}
          </TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="py-2 px-3 pt-0">
        <div className="flex items-center justify-between mb-2">
          {/* Priority Icon + PR indicator */}
          <div className="flex items-center gap-1.5 shrink-0">
            {getPriorityIcon(task.priority)}
            {task.pullRequestState &&
              (() => {
                const meta = PR_STATE_META[task.pullRequestState];
                const Icon = meta.icon;
                return (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="inline-flex" />}
                      aria-label={meta.label}
                    >
                      <Icon className={cn("h-3.5 w-3.5", meta.className)} />
                    </TooltipTrigger>
                    <TooltipContent side="top">{meta.label}</TooltipContent>
                  </Tooltip>
                );
              })()}
          </div>

          {/* Right cluster: remote (GitHub) facepile, then the internal
              assignee. The GitHub mark sits on the left of the remote group
              (side="right"); a small vertical rule divides the remote facepile
              from the local one — shown only when both exist. */}
          <div className="flex items-center gap-1.5 shrink-0">
            <ExternalAssigneeAvatars assignees={task.externalAssignees} side="right" />
            {hasExternalAssignees && task.assignee && (
              <div className="h-4 w-px bg-border" aria-hidden />
            )}

            {/* Assignee — the picker occupies the slot whether or not the
                task is assigned (dotted circle when empty), so the row height
                is stable and assigning never needs the detail sheet. */}
            {interactive ? (
              <KanbanAssigneePicker
                taskId={task._id}
                assigneeId={task.assigneeId}
                assignee={task.assignee}
              />
            ) : task.assignee ? (
              <UserAvatar
                className="h-6 w-6"
                name={task.assignee.name}
                image={task.assignee.image}
                alt={task.assignee.name ?? "Assignee"}
                fallbackClassName="text-xs"
              />
            ) : (
              <div className="h-6 w-6" aria-hidden />
            )}
          </div>
        </div>

        {/* Tags — fixed height, single row with fade + tooltip */}
        <div className="min-h-5.5">
          {task.labels && task.labels.length > 0 ? (
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1 overflow-hidden w-full mask-[linear-gradient(to_right,black_calc(100%-20px),transparent)]">
                {task.labels.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-xs py-0 shrink-0"
                  >
                    {tag}
                  </Badge>
                ))}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64">
                <div className="flex flex-wrap gap-1">
                  {task.labels.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs rounded bg-background/20 px-1.5 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="invisible text-xs leading-5.5" aria-hidden>
              &#8203;
            </span>
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
