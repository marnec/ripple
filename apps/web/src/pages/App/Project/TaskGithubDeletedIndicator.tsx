import type { Id } from "@convex/_generated/dataModel";
import { Unlink } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTaskGithubLink } from "./useTaskGithubLink";

type Props = { taskId: Id<"tasks">; className?: string };

/**
 * Header affordance shown only when the linked GitHub issue was deleted
 * upstream. An amber `Unlink` icon whose tooltip explains that the task is
 * kept but no longer synced. Renders nothing for healthy / Ripple-native
 * tasks, so headers pay no layout cost when there's nothing to say.
 */
export function TaskGithubDeletedIndicator({ taskId, className }: Props) {
  const { issueDeleted } = useTaskGithubLink(taskId);
  if (!issueDeleted) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("inline-flex", className)} />}
        aria-label="GitHub issue deleted"
      >
        <Unlink className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56">
        This issue was deleted on GitHub — the task is no longer synced.
      </TooltipContent>
    </Tooltip>
  );
}
