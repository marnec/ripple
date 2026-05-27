import type { Id } from "@convex/_generated/dataModel";
import { TaskGithubDeletedIndicator } from "./TaskGithubDeletedIndicator";

type Props = {
  taskId: Id<"tasks">;
};

/**
 * GitHub affordances for a task-detail header. Currently just the "issue
 * deleted" indicator — the "open on GitHub" link lives on the `#NN` issue-ref
 * chip (TaskGithubIssueRef), so there's no separate open button here. The
 * indicator self-conditionalizes (renders nothing unless the issue was
 * deleted), so for a native task this cluster collapses to nothing and occupies
 * no header space.
 */
export function TaskGithubHeaderActions({ taskId }: Props) {
  return <TaskGithubDeletedIndicator taskId={taskId} />;
}
