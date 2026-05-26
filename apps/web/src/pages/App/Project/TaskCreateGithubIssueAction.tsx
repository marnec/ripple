import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@convex/_generated/dataModel";
import { useGithubIssueEligibility } from "./useGithubIssueEligibility";
import { CreateGithubIssueDialog } from "./CreateGithubIssueDialog";

type Props = {
  taskId: Id<"tasks">;
  taskTitle: string;
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  /** Task is already linked to a GitHub issue — nothing to create. */
  isLinked: boolean;
  /** Completed tasks can't spawn an issue (matches the dispatcher guard). */
  completed: boolean;
};

/**
 * Header affordance to create a GitHub issue from an existing task. Self-gates:
 * renders nothing unless the workspace has the integration, the project has a
 * connected repo, and the task is neither already linked nor completed — so it
 * collapses to nothing for the common native-task case and occupies no space.
 */
export function TaskCreateGithubIssueAction({
  taskId,
  taskTitle,
  projectId,
  workspaceId,
  isLinked,
  completed,
}: Props) {
  const { eligible } = useGithubIssueEligibility(projectId, workspaceId);
  const [open, setOpen] = useState(false);

  if (!eligible || isLinked || completed) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        title="Create GitHub issue from this task"
      >
        <GitBranch className="h-4 w-4" />
      </Button>
      <CreateGithubIssueDialog
        taskId={taskId}
        taskTitle={taskTitle}
        projectId={projectId}
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
