import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

type TaskDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (closeGithubIssue: boolean) => void;
  /** When true, offer to also close the linked GitHub issue. */
  isGithubLinked?: boolean;
};

export function TaskDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  isGithubLinked = false,
}: TaskDeleteDialogProps) {
  const [closeGithubIssue, setCloseGithubIssue] = useState(false);

  // Reset the opt-in each time the dialog opens so a prior choice never carries
  // over into an unrelated deletion. Adjusting state during render off a prop
  // change is React's recommended alternative to an effect here.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setCloseGithubIssue(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete Task</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Delete this task? This action cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {isGithubLinked && (
          <Label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox
              checked={closeGithubIssue}
              onCheckedChange={(checked) =>
                setCloseGithubIssue(checked === true)
              }
              className="mt-0.5"
            />
            <span>
              Also close the linked GitHub issue.{" "}
              <span className="text-muted-foreground">
                Marks the issue as completed on GitHub. (Issues can&apos;t be
                deleted via the API.)
              </span>
            </span>
          </Label>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(closeGithubIssue)}
          >
            Delete
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
