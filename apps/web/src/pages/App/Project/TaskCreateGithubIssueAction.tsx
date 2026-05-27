import { useState } from "react";
import { CircleDot } from "lucide-react";
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
 * Header affordance to create a GitHub issue from an existing task. Renders
 * nothing unless the workspace has the integration and the project has a
 * connected repo — so it collapses to nothing for the common native-task case.
 * Once eligible it stays in place and disables (rather than disappearing) when
 * there's nothing to create — already linked, or completed — mirroring the
 * create-branch button, so the header doesn't reflow as the task links.
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

  if (!eligible) return null;

  const disabled = isLinked || completed;
  const title = isLinked
    ? "Already linked to a GitHub issue"
    : completed
      ? "Completed tasks can't create an issue"
      : "Create GitHub issue from this task";

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={title}
      >
        <CircleDot className="h-4 w-4" />
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
