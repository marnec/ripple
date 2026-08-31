/**
 * "Notify invitees?" prompt shown after the organizer drags or resizes
 * an event that has guests. Mirrors Google Calendar's three-button
 * pattern:
 *   • Send updates — apply the change, send in-app + email notifications
 *   • Don't send   — apply the change silently
 *   • Revert       — undo the visual change, no persistence
 *
 * Skipped entirely when an event has no non-organizer invitees — there's
 * nobody to notify, so we'd just be adding friction. The parent
 * (MyCalendarTab) decides when to render this; it stays presentation-
 * only here.
 */

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@ripple/ui/components/button";

export type RescheduleChoice = "send" | "silent" | "revert";

export function NotifyInviteesDialog({
  open,
  onOpenChange,
  eventTitle,
  oldRangeLabel,
  newRangeLabel,
  summary,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventTitle: string;
  /** The before/after times. Absent when the edit moved nothing — a rename
   *  has no "was" and no "now" to show. */
  oldRangeLabel?: string;
  newRangeLabel?: string;
  /**
   * What this will actually send — "2 invitees, this occurrence". Both halves
   * matter: the same sentence must not appear whether one Tuesday or
   * forty-seven meetings are moving. Computed by `decideNotify`.
   */
  summary: string;
  onChoose: (choice: RescheduleChoice) => void;
}) {
  const movedInTime =
    oldRangeLabel !== undefined && newRangeLabel !== undefined;
  // Wrapper so any path that closes the dialog without an explicit
  // choice (X button, ESC, click-outside) treats it as a revert. This
  // matches Google Calendar's behaviour and prevents accidental silent
  // reschedules.
  const handleOpenChange = (next: boolean) => {
    if (!next && open) onChoose("revert");
    onOpenChange(next);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Notify invitees?</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {/* The two numbers that make the answer decidable: how many
                people, and how much of the meeting. */}
            {eventTitle ? `"${eventTitle}" — ` : ""}
            {summary}. Choose whether to let them know
            {movedInTime ? " about the new time" : " about the change"}.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-2">
          {/* Before/after summary — small, calm, gives a glance-able
              confirmation of what changed before the user commits. Absent
              when nothing moved, because there is nothing to compare. */}
          {movedInTime && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide w-12 shrink-0">
                  Was
                </span>
                <span className="text-muted-foreground line-through tabular-nums">
                  {oldRangeLabel}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide w-12 shrink-0">
                  Now
                </span>
                <span className="font-medium tabular-nums">{newRangeLabel}</span>
              </div>
            </div>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChoose("revert")}
          >
            Revert
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChoose("silent")}
          >
            Don't send
          </Button>
          <Button type="button" onClick={() => onChoose("send")}>
            Send updates
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
