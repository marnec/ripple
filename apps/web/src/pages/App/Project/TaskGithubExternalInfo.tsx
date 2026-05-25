import type { Id } from "@convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTaskGithubLink } from "./useTaskGithubLink";

type Props = { taskId: Id<"tasks"> };

/**
 * GitHub-specific "closed by" display on the task detail surface.
 *
 *  - "Closed on GitHub by @login": when an externally-closed issue was
 *    flipped by a non-member, we surface who did it.
 *
 * External assignees that didn't win Ripple's single slot render beside the
 * internal assignee in the Assignee property row (`ExternalAssigneeAvatars`),
 * not here. The "issue deleted on GitHub" signal lives in the header
 * (`TaskGithubDeletedIndicator`).
 *
 * Renders nothing when the task has no link or wasn't externally closed —
 * Ripple-native tasks pay no UI cost.
 */
export function TaskGithubExternalInfo({ taskId }: Props) {
  const { closedBy } = useTaskGithubLink(taskId);
  if (!closedBy) return null;

  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">

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
