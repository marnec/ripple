import { useState } from "react";
import { Button } from "@ripple/ui/components/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
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
  /** How many tasks the confirm deletes — the bulk action passes its selection size. */
  count?: number;
};

export function TaskDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  isGithubLinked = false,
  count = 1,
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
          <ResponsiveDialogTitle>
            {count === 1 ? "Delete Task" : `Delete ${count} Tasks`}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {count === 1 ? "Delete this task?" : `Delete these ${count} tasks?`} This
            action cannot be undone.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {isGithubLinked && (
          // Body, not a bare child: in the mobile drawer only header, footer
          // and body carry side padding.
          <ResponsiveDialogBody>
            <Label className="flex items-start gap-2 text-sm font-normal">
              <Checkbox
                checked={closeGithubIssue}
                onCheckedChange={(checked) =>
                  setCloseGithubIssue(checked === true)
                }
                className="mt-0.5"
              />
              <span>
                {count === 1
                  ? "Also close the linked GitHub issue."
                  : "Also close the linked GitHub issues."}{" "}
                <span className="text-muted-foreground">
                  {count === 1 ? "Marks the issue" : "Marks them"} as completed on GitHub. (Issues can&apos;t be
                  deleted via the API.)
                </span>
              </span>
            </Label>
          </ResponsiveDialogBody>
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
