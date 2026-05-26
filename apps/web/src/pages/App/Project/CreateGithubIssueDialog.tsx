import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { GithubIssueFields } from "./GithubIssueFields";
import { useGithubIssueDraft } from "./useGithubIssueDraft";
import { useGithubIssueEligibility } from "./useGithubIssueEligibility";

type Props = {
  taskId: Id<"tasks">;
  taskTitle: string;
  projectId: Id<"projects">;
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Detail-time entry point for "create a GitHub issue from this task". Summoned
 * from the task-detail header; pre-fills the issue title from the task title
 * and lets the user pick the target repo. The issue is created asynchronously —
 * the link surfaces in the header once the recorder writes it.
 */
export function CreateGithubIssueDialog({
  taskId,
  taskTitle,
  projectId,
  workspaceId,
  open,
  onOpenChange,
}: Props) {
  const { links } = useGithubIssueEligibility(projectId, workspaceId);
  const draft = useGithubIssueDraft(taskTitle, links);
  const createIssue = useMutation(api.tasks.createGithubIssue);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) draft.reset();
    onOpenChange(next);
  };

  const submit = () => {
    if (!draft.repoLinkId || draft.title.trim().length === 0) return;
    setSubmitting(true);
    createIssue({
      taskId,
      projectIntegrationLinkId: draft.repoLinkId,
      title: draft.title.trim(),
      body: "",
    })
      .then(() => {
        toast.success("Creating GitHub issue…", {
          description: "The link will appear here once it's created.",
        });
        draft.reset();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toast.error("Couldn't create the issue", {
          description: err instanceof Error ? err.message : "Please try again",
        });
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Create GitHub issue</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Create an issue on a connected repository and link it to this task.
            Merging a PR into a mapped branch will then move the task.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <GithubIssueFields draft={draft} links={links} disabled={submitting} />
          <ResponsiveDialogFooter className="mt-4">
            <Button
              onClick={submit}
              disabled={
                submitting || !draft.repoLinkId || draft.title.trim().length === 0
              }
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create issue
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
