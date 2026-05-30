import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = { taskId: Id<"tasks"> };

type PrState = "draft" | "open" | "merged" | "closed";

const STATE_META: Record<
  PrState,
  { icon: LucideIcon; label: string; className: string }
> = {
  draft: {
    icon: GitPullRequestDraft,
    label: "Draft",
    className: "text-white",
  },
  open: {
    icon: GitPullRequest,
    label: "Open",
    className: "text-white",
  },
  merged: {
    icon: GitMerge,
    label: "Merged",
    className: "text-white",
  },
  closed: {
    icon: GitPullRequestClosed,
    label: "Closed",
    className: "text-white",
  },
};

/**
 * Linked pull/merge requests on the task detail surface. A PR is an
 * attachment, resolved from the host's "Closes #N" references. Renders
 * nothing when the task has no linked PRs, so native tasks pay no UI cost.
 */
export function TaskPullRequests({ taskId }: Props) {
  const prs = useQuery(api.integrations.core.pullRequestLinks.listByTask, {
    taskId,
  });
  if (!prs || prs.length === 0) return null;

  return (
    <div className="space-y-2 animate-fade-in">
      <h3 className="text-sm font-semibold text-muted-foreground">
        Pull requests
      </h3>
      <TooltipProvider delay={120}>
        <ul className="flex flex-col gap-1.5">
          {prs.map((pr) => {
            const meta = STATE_META[pr.state];
            const Icon = meta.icon;
            return (
              <li key={`${pr.number}-${pr.url}`}>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Icon className={`h-4 w-4 shrink-0 ${meta.className}`} />
                  <span className="truncate font-medium text-foreground group-hover:underline">
                    {pr.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    #{pr.number}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge variant="outline" className="ml-auto shrink-0" />
                      }
                    >
                      {meta.label}
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {pr.headRef} → {pr.baseRef}
                    </TooltipContent>
                  </Tooltip>
                </a>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
    </div>
  );
}
