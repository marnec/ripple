import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TaskCode } from "@/components/TaskCode";
import { TaskGithubIssueRef } from "./TaskGithubIssueRef";
import { cn } from "@/lib/utils";
import { formatDueDate, formatEstimate, isOverdue, getPriorityIcon } from "@/lib/task-utils";
import { ExternalAssigneeAvatars, type ExternalAssignee } from "./ExternalAssignees";
import {
  Ban,
  CalendarIcon,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PR_STATE_META: Record<
  "draft" | "open" | "merged" | "closed",
  { icon: LucideIcon; label: string; className: string }
> = {
  draft: { icon: GitPullRequestDraft, label: "Draft PR", className: "text-muted-foreground" },
  open: { icon: GitPullRequest, label: "Open PR", className: "text-emerald-600 dark:text-emerald-400" },
  merged: { icon: GitMerge, label: "Merged PR", className: "text-violet-600 dark:text-violet-400" },
  closed: { icon: GitPullRequestClosed, label: "Closed PR", className: "text-rose-600 dark:text-rose-400" },
};

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
    pullRequestState?: "draft" | "open" | "merged" | "closed";
    externalRefs?: Array<{
      repoFullName?: string;
      issueNumber?: number;
      url?: string;
      deleted?: boolean;
    }>;
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
      className={cn(
        "cursor-grab active:cursor-grabbing py-0 gap-0 border shadow ring-0 dark:bg-stone-950 bg-stone-100",
        isDragging && "shadow-lg rotate-2"
      )}
    >
      <CardHeader className="py-2 px-3">
        <div className="flex items-center gap-1.5 min-h-4">
          {task.hasBlockers && (
            <span title="Blocked"><Ban className="h-3 w-3 text-red-500 shrink-0" /></span>
          )}
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
          <TaskGithubIssueRef
            repoFullName={task.externalRefs?.[0]?.repoFullName}
            issueNumber={task.externalRefs?.[0]?.issueNumber}
            url={task.externalRefs?.[0]?.url}
            deleted={task.externalRefs?.[0]?.deleted}
          />
        </div>
        <h3 className="text-sm font-medium truncate">{task.title}</h3>
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

          {/* External (GitHub) assignees — left of the internal assignee,
              separated by a GitHub mark. */}
          <ExternalAssigneeAvatars assignees={task.externalAssignees} side="left" />

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
