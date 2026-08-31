/**
 * Desktop side-panel detail surface for one **occurrence** of a series. The
 * mobile counterpart is `OccurrenceDetailPage`; `MyCalendarTab` decides which
 * to open based on viewport, exactly as it does for a one-off event.
 *
 * Occurrences used to go to the page on every device, on the reasoning that
 * the sheet was built around an event row an occurrence does not have. That
 * was true of `EventDetailSheet` and never true of the surface itself: what a
 * side panel needs is a body, and `OccurrenceDetailContent` is one. So a click
 * on a Tuesday now opens beside the calendar it was clicked on, and the
 * Maximize2 button in the corner is the way to the full page — the same
 * affordance `EventDetailSheet` and `TaskDetailSheet` carry.
 */
import { useNavigate } from "react-router-dom";
import { CalendarX2, Maximize2, Repeat, Trash2 } from "lucide-react";

import { Button } from "@ripple/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Id } from "@convex/_generated/dataModel";

import { EditableTitle } from "./event-detail-blocks";
import { JoinCallButton } from "./JoinCallButton";
import { OccurrenceDetailContent, OccurrenceDetailDialogs } from "./OccurrenceDetailContent";
import { RsvpResponseGroup } from "./RsvpResponseGroup";
import { useOccurrenceDetail } from "./occurrence-detail-data";

export function OccurrenceDetailSheet({
  occurrence,
  open,
  onOpenChange,
  workspaceId,
  onOverrideCreated,
}: {
  /** `null` between closing the sheet and the exit animation finishing. */
  occurrence: {
    seriesId: Id<"eventSeries">;
    originalStartMs: number;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
  /**
   * A single-occurrence edit turns this Tuesday into an override with an event
   * row of its own, which is what `EventDetailSheet` shows. Handing the id
   * back lets the calendar swap one panel for the other instead of throwing
   * the viewer onto a full page they did not ask for.
   */
  onOverrideCreated?: (eventId: Id<"calendarEvents">) => void;
}) {
  const navigate = useNavigate();
  const detail = useOccurrenceDetail({
    workspaceId,
    seriesId: occurrence?.seriesId ?? null,
    originalStartMs: occurrence?.originalStartMs ?? null,
    onOverrideCreated: onOverrideCreated
      ? (eventId) => {
          onOpenChange(false);
          onOverrideCreated(eventId);
        }
      : undefined,
    onGone: () => onOpenChange(false),
  });
  const { series, editable, rsvp, callStatus, joinCall, skip, setConfirmingDelete, propose } =
    detail;

  const expandToPage = () => {
    if (!occurrence) return;
    onOpenChange(false);
    void navigate(
      `/workspaces/${workspaceId}/events/${occurrence.seriesId}?on=${occurrence.originalStartMs}`,
    );
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Same width override as EventDetailSheet: the base applies
          `data-[side=right]:sm:max-w-sm`, so ours has to match that modifier
          signature exactly for twMerge to dedupe it. */}
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 outline-none data-[side=right]:sm:max-w-xl"
        >
          {!series ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {series === null ? "Event not found" : null}
            </div>
          ) : (
            <>
              <SheetHeader className="border-b p-4 pb-3">
                <div className="flex items-start gap-2 pr-20">
                  <Repeat className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  {editable ? (
                    // Wrapped in SheetTitle through TitleSlot so the dialog's
                    // a11y labelling still hooks up while the read-mode title is
                    // a button and the edit-mode one an Input.
                    <EditableTitle
                      value={series.title}
                      onSave={(title) => propose({ kind: "content", fields: { title } })}
                      TitleSlot={SheetTitle}
                    />
                  ) : (
                    <SheetTitle className="truncate text-base">{series.title}</SheetTitle>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-12 top-3"
                  onClick={expandToPage}
                  title="Expand to full page"
                  aria-label="Expand to full page"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </SheetHeader>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <OccurrenceDetailContent detail={{ ...detail, series }} workspaceId={workspaceId} />
              </div>

              <div className="flex flex-col gap-2 border-t p-3">
                <JoinCallButton
                  status={callStatus}
                  onJoin={joinCall}
                  className="w-full"
                  pendingClassName="text-center"
                />
                {rsvp && (
                  <RsvpResponseGroup
                    myStatus={rsvp.myStatus}
                    onRespond={(status) => void rsvp.respond(status)}
                    className="grid grid-cols-3 gap-1.5"
                  />
                )}
                {editable && (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => void skip()}
                    >
                      <CalendarX2 className="mr-1.5 h-4 w-4" />
                      Skip this occurrence
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete series
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {/* Siblings of the sheet, not children: nested overlays fight over focus
          and stacking order. */}
      {series && <OccurrenceDetailDialogs detail={{ ...detail, series }} />}
    </>
  );
}
