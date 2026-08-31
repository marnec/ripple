import type { ReactNode } from "react";

import { Button } from "@ripple/ui/components/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  /** The verb on the confirming button — "Delete", "Cancel event", "Remove". */
  confirmLabel: string;
  /** The way out. Defaults to "Cancel", which reads wrong when the action
   *  itself is a cancellation and both buttons would say the same word. */
  dismissLabel?: string;
};

/**
 * The plain "are you sure?" — a title, a sentence, and two buttons.
 *
 * It exists because the alternative is `window.confirm`, which renders as an
 * unstyled browser chrome alert that is not responsive, cannot be themed, and
 * on mobile is a system sheet rather than the drawer every other question in
 * the app arrives as. Anything that needs more than a sentence — a checkbox, a
 * list of what will break — gets its own dialog instead (`TaskDeleteDialog`,
 * `DeleteWarningDialog`); this one deliberately does not grow those.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  dismissLabel = "Cancel",
}: ConfirmDialogProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {dismissLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
