import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { GitBranchPlus, GitPullRequestCreate, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useTaskGithubLink } from "./useTaskGithubLink";

type Props = {
  taskId: Id<"tasks">;
  /** From `task.externalRefs[0]` — present only for an issue-linked task. */
  repoFullName: string | undefined;
  issueNumber: number | undefined;
  taskTitle: string;
};

/**
 * Branch/PR affordances for an issue-linked task's detail header:
 *  - no branch yet → "Create branch" (server creates `<issueNumber>-<slug>`
 *    off the default branch; the chip then appears reactively),
 *  - branch exists → copy the branch name + open a prefilled "Create pull
 *    request" compare page (`Closes #N` in the body, so it links + automates).
 *
 * Self-gates to nothing for native or issue-deleted tasks.
 */
export function TaskGithubBranchActions({
  taskId,
  repoFullName,
  issueNumber,
  taskTitle,
}: Props) {
  const gh = useTaskGithubLink(taskId);
  const createBranch = useAction(
    api.integrations.github.branchesAction.createBranchForTask,
  );
  const [creating, setCreating] = useState(false);

  if (
    !gh.isLinked ||
    gh.issueDeleted ||
    !repoFullName ||
    issueNumber === undefined
  ) {
    return null;
  }

  const branch = gh.branchName;

  const handleCreate = () => {
    setCreating(true);
    createBranch({ taskId })
      .then((res) => {
        toast.success(
          res.alreadyExisted ? "Branch already exists" : "Branch created",
          { description: res.branchName },
        );
      })
      .catch((err: unknown) => {
        toast.error("Couldn't create branch", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      })
      .finally(() => setCreating(false));
  };

  const compareUrl = branch
    ? `https://github.com/${repoFullName}/compare/${encodeURIComponent(branch)}` +
      `?expand=1&title=${encodeURIComponent(taskTitle)}` +
      `&body=${encodeURIComponent(`Closes #${issueNumber}`)}`
    : null;

  // Create PR is leftmost (appears once a branch exists); the create-branch
  // button follows it and disables in place once a branch has been created.
  return (
    <>
      {compareUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Create pull request"
          onClick={() =>
            window.open(compareUrl, "_blank", "noopener,noreferrer")
          }
        >
          <GitPullRequestCreate className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={branch !== null || creating}
        onClick={branch ? undefined : handleCreate}
        title={
          branch
            ? `Branch created: ${branch}`
            : "Create a branch for this issue"
        }
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GitBranchPlus className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}
