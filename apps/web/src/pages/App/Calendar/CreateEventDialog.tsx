import { useState } from "react";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

import type { Id } from "@convex/_generated/dataModel";
import { CreateEventForm } from "./CreateEventForm";

/**
 * Dialog wrapper around `<CreateEventForm />`. Used for the global
 * "+ New event" button in the calendar header (and the mobile
 * HeaderSlot equivalent — `ResponsiveDialog` swaps to a Drawer there).
 *
 * The click/drag-to-create flow on the calendar's time grid uses
 * `<InlineEventCreator />` instead, which mounts the same form inside
 * a Popover anchored to a ghost event. That surface owns its own
 * lifecycle, so this dialog is no longer the only entry point for
 * event creation.
 *
 * Re-seed strategy: the parent keeps this dialog mounted across closes
 * (so the exit animation can play), so we can't rely on natural
 * unmounting to drop stale form state. Instead we bump a `seedKey` on
 * every false → true open transition and pass it as React `key` to
 * `<CreateEventForm />`, forcing a fresh mount with the latest
 * `initialDate`.
 */
export function CreateEventDialog({
  workspaceId,
  open,
  onOpenChange,
  initialDate,
  initialMemberIds,
}: {
  workspaceId: Id<"workspaces">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date;
  /** See `CreateEventForm.initialMemberIds`. Forwarded as-is — the
   *  parent's `seedKey`-driven `key` remount on every false→true open
   *  ensures a stale prop from the previous session doesn't carry over
   *  between dialog openings. */
  initialMemberIds?: Id<"users">[];
}) {
  // Increments on every false→true open transition so React remounts
  // the inner form with fresh defaults derived from the current
  // `initialDate`. The render-time ratchet (matches the `*Mounted`
  // patterns elsewhere in this codebase) avoids `react-hooks/
  // set-state-in-effect` while still firing exactly once per
  // transition: React deduplicates the state update when the new
  // value is the same, and the `lastOpen` guard makes both branches
  // no-op once they've settled.
  const [seedKey, setSeedKey] = useState(0);
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (open) setSeedKey((k) => k + 1);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} direction="top">
      {/* Override the Dialog's default sm:max-w-sm — the date + two time
          pills + invitee inputs need ~32rem to lay out without overflow. */}
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New event</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Schedule a call and invite people. Guests can join via email
            invitation; workspace members get an in-app notification.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="pb-4">
          <CreateEventForm
            key={seedKey}
            workspaceId={workspaceId}
            initialDate={initialDate}
            initialMemberIds={initialMemberIds}
            onSuccess={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
