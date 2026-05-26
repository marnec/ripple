import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "convex/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useGithubIssueEligibility } from "./useGithubIssueEligibility";
import { GithubIssueFields } from "./GithubIssueFields";
import { useGithubIssueDraft } from "./useGithubIssueDraft";

type CreateTaskDialogProps = {
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plannedStartDate?: string;
};

export function CreateTaskDialog({
  projectId,
  workspaceId,
  open,
  onOpenChange,
  plannedStartDate,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [alsoCreateIssue, setAlsoCreateIssue] = useState(false);
  const createTask = useMutation(api.tasks.create);
  const createIssue = useMutation(api.tasks.createGithubIssue);

  // The issue title follows the task title until the user edits it.
  const { eligible, links } = useGithubIssueEligibility(projectId, workspaceId);
  const draft = useGithubIssueDraft(title, links);

  const reset = () => {
    setTitle("");
    setAlsoCreateIssue(false);
    draft.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const wantsIssue = alsoCreateIssue && eligible && draft.repoLinkId !== null;
    const repoLinkId = draft.repoLinkId;
    const issueTitle = draft.title.trim();

    setIsCreating(true);
    createTask({ projectId, workspaceId, title: trimmedTitle, plannedStartDate })
      .then(async (taskId) => {
        // Best-effort: a task is created even if the issue request is rejected,
        // so surface that separately rather than failing the whole flow.
        if (wantsIssue && repoLinkId && issueTitle) {
          try {
            await createIssue({
              taskId,
              projectIntegrationLinkId: repoLinkId,
              title: issueTitle,
              body: "",
            });
            toast.success("Task created — creating GitHub issue…");
          } catch (err) {
            toast.error("Task created, but the GitHub issue failed", {
              description:
                err instanceof Error ? err.message : "Please try again",
            });
          }
        }
        reset();
        onOpenChange(false);
      })
      .catch((error) => {
        toast.error("Failed to create task", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => setIsCreating(false));
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} direction="top">
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Task</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              autoFocus
              placeholder="Task name"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isCreating}
            />
            {eligible && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={alsoCreateIssue}
                    disabled={isCreating}
                    onCheckedChange={(c) => setAlsoCreateIssue(c === true)}
                  />
                  Also create a GitHub issue
                </label>
                {alsoCreateIssue && (
                  <GithubIssueFields
                    draft={draft}
                    links={links}
                    disabled={isCreating}
                  />
                )}
              </div>
            )}
            <ResponsiveDialogFooter>
              <Button type="submit" disabled={isCreating || !title.trim()}>
                Create
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
