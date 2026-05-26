import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@convex/_generated/dataModel";
import { TaskGithubDeletedIndicator } from "./TaskGithubDeletedIndicator";

type Props = {
  taskId: Id<"tasks">;
  /**
   * The linked GitHub issue URL, if any. The "open on GitHub" button renders
   * only when present — a Ripple-native task shows no GitHub affordance.
   */
  issueUrl: string | undefined;
};

/**
 * GitHub affordances for a task-detail header: the "issue deleted" indicator
 * and an "open linked issue on GitHub" button. Both self-conditionalize — the
 * deleted indicator renders nothing unless the issue was deleted, and the open
 * button renders nothing for tasks with no linked issue — so for a native task
 * this cluster collapses to nothing and occupies no header space. Designed to
 * sit inside a flex row in each host so gaps close as items appear/disappear.
 */
export function TaskGithubHeaderActions({ taskId, issueUrl }: Props) {
  return (
    <>
      <TaskGithubDeletedIndicator taskId={taskId} />
      {issueUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() =>
            window.open(issueUrl, "_blank", "noopener,noreferrer")
          }
          title="Open linked issue on GitHub"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
    </>
  );
}
