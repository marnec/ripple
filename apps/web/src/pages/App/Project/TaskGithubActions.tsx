import type { Id } from "@convex/_generated/dataModel";
import { TaskCreateGithubIssueAction } from "./TaskCreateGithubIssueAction";
import { TaskGithubBranchActions } from "./TaskGithubBranchActions";
import { TaskGithubHeaderActions } from "./TaskGithubHeaderActions";

/**
 * The GitHub action trio shared by both task-detail surfaces (full page and
 * sheet): create-issue, branch actions, and the header overflow menu. Both
 * surfaces previously inlined these three with identical wiring and repeated
 * `externalRefs?.[0]?.*` drilling — this owns that access once. The two
 * surfaces still control their own layout around this fragment.
 */
export function TaskGithubActions({
  task,
  projectId,
  workspaceId,
}: {
  task: {
    _id: Id<"tasks">;
    title: string;
    completed: boolean;
    externalRefs?: Array<{
      repoFullName?: string;
      issueNumber?: number;
      url?: string;
    }>;
  };
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
}) {
  const ref = task.externalRefs?.[0];
  return (
    <>
      <TaskCreateGithubIssueAction
        taskId={task._id}
        taskTitle={task.title}
        projectId={projectId}
        workspaceId={workspaceId}
        isLinked={Boolean(ref)}
        completed={task.completed}
      />
      <TaskGithubBranchActions
        taskId={task._id}
        repoFullName={ref?.repoFullName}
        issueNumber={ref?.issueNumber}
        taskTitle={task.title}
      />
      <TaskGithubHeaderActions taskId={task._id} issueUrl={ref?.url} />
    </>
  );
}
