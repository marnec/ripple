import { useState } from "react";
import { CircleDot } from "lucide-react";
import { Button } from "@ripple/ui/components/button";
import type { Doc } from "@convex/_generated/dataModel";
import type { Id } from "@convex/_generated/dataModel";
import { CreateGithubIssueDialog } from "./CreateGithubIssueDialog";
import { TaskGithubBranchActions } from "./TaskGithubBranchActions";
import { TaskGithubDeletedIndicator } from "./TaskGithubDeletedIndicator";
import {
  deriveCreateIssueAffordance,
  useGithubIssueEligibility,
} from "./useGithubIssueEligibility";

/**
 * Every GitHub/GitLab affordance a task-detail header carries, for both
 * surfaces (full page and sheet): the deleted-issue indicator, the branch/PR
 * cluster, and create-issue. Both surfaces previously inlined these with
 * identical wiring and repeated `externalRefs?.[0]?.*` drilling — this owns that
 * access once. The two surfaces still control their own layout around this
 * fragment.
 *
 * Fixed left-to-right order: createPR, createBranch (both inside
 * TaskGithubBranchActions), then createIssue. The host header appends its own
 * [close]/[expand] after this fragment. The deleted indicator leads but usually
 * renders nothing, so it doesn't shift the visible order — and for a native
 * task with no integration the whole fragment collapses to nothing.
 */
export function TaskGithubActions({
  task,
  projectId,
  workspaceId,
}: {
  task: Pick<Doc<"tasks">, "_id" | "title" | "completed" | "labels" | "externalRefs">;
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
}) {
  const ref = task.externalRefs?.[0];
  const { eligible, provider } = useGithubIssueEligibility(
    projectId,
    workspaceId,
  );
  const createIssue = deriveCreateIssueAffordance({
    eligible,
    provider,
    isLinked: Boolean(ref),
    completed: task.completed,
  });
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  return (
    <>
      <TaskGithubDeletedIndicator taskId={task._id} />
      <TaskGithubBranchActions
        taskId={task._id}
        repoFullName={ref?.repoFullName}
        issueNumber={ref?.issueNumber}
        taskTitle={task.title}
      />
      {createIssue.show && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={createIssue.disabled}
            onClick={() => setIssueDialogOpen(true)}
            title={createIssue.reason}
          >
            <CircleDot className="h-4 w-4" />
          </Button>
          <CreateGithubIssueDialog
            taskId={task._id}
            taskTitle={task.title}
            taskLabels={task.labels ?? []}
            projectId={projectId}
            workspaceId={workspaceId}
            open={issueDialogOpen}
            onOpenChange={setIssueDialogOpen}
          />
        </>
      )}
    </>
  );
}
