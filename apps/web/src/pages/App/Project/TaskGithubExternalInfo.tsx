import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = { taskId: Id<"tasks"> };

/**
 * GitHub-specific assignee + closer display on the task detail surface.
 *
 *  - Shadow chips: when a GitHub issue had multiple assignees, only one wins
 *    Ripple's single `assigneeId` slot. The remainder render here as muted
 *    avatar chips linking to their GitHub profile, so the multi-assignee
 *    story isn't lost.
 *  - "Closed on GitHub by @login": when an externally-closed issue was
 *    flipped by a non-member, we surface who did it.
 *
 * Renders nothing when the task has no link or neither datum is present —
 * Ripple-native tasks pay no UI cost.
 */
export function TaskGithubExternalInfo({ taskId }: Props) {
  const link = useQuery(api.integrations.core.taskLinks.getByTask, { taskId });
  if (!link) return null;

  const shadowAssignees = link.externalAssignees ?? [];
  const closedBy = link.externalClosedBy;
  if (shadowAssignees.length === 0 && !closedBy) return null;

  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {shadowAssignees.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0">Also assigned on GitHub:</span>
          <TooltipProvider delay={120}>
            <div className="flex flex-wrap items-center gap-1">
              {shadowAssignees.map((a) => (
                <Tooltip key={a.login}>
                  <TooltipTrigger
                    render={
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open @${a.login} on GitHub`}
                        className="inline-flex"
                      />
                    }
                  >
                    <Avatar className="h-5 w-5 ring-1 ring-border opacity-80 hover:opacity-100 transition-opacity">
                      <AvatarImage src={a.avatarUrl} alt={`@${a.login}`} />
                      <AvatarFallback className="text-[10px]">
                        {a.login.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="top">@{a.login}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        </div>
      )}

      {closedBy && (
        <div className="flex items-center gap-1.5">
          <span>Closed on GitHub by</span>
          <a
            href={closedBy.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
          >
            <Avatar className="h-4 w-4">
              <AvatarImage src={closedBy.avatarUrl} alt={`@${closedBy.login}`} />
              <AvatarFallback className="text-[9px]">
                {closedBy.login.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            @{closedBy.login}
          </a>
        </div>
      )}
    </div>
  );
}
