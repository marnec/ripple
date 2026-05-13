/**
 * Desktop side-panel detail surface for a calendar event. The mobile
 * counterpart is `EventDetailPage` (a full route at /events/:eventId);
 * `MyCalendarTab` decides which to open based on viewport. Both consume
 * the same `useEventDetail` hook and `EventDetailContent` body, so
 * editing here and there feels identical at the field level.
 *
 * The Maximize2 button in the corner navigates to the full page —
 * mirrors the same affordance on `TaskDetailSheet`.
 */

import { useNavigate } from "react-router-dom";
import {
  CalendarDays as CalendarDaysIcon,
  Maximize2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import type { Id } from "@convex/_generated/dataModel";
import { EditableTitle } from "./event-detail-blocks";
import { useEventDetail } from "./event-detail-data";
import { EventDetailContent } from "./EventDetailContent";
import { JoinCallButton } from "./JoinCallButton";
import { RsvpResponseGroup } from "./RsvpResponseGroup";

export function EventDetailSheet({
  eventId,
  open,
  onOpenChange,
  workspaceId,
}: {
  eventId: Id<"calendarEvents"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: Id<"workspaces">;
}) {
  const navigate = useNavigate();
  const {
    detail,
    channels,
    members,
    myInvitee,
    isOrganizer,
    editable,
    callStatus,
    saveField,
    handleRespond,
    handleCancel,
    handleAddInvitees,
    handleSelfInvite,
    handleRemoveInvitee,
  } = useEventDetail({ eventId, workspaceId });

  const onCancel = async () => {
    if (await handleCancel()) onOpenChange(false);
  };

  const joinCall = () => {
    if (!eventId) return;
    void navigate(`/workspaces/${workspaceId}/events/${eventId}/videocall`);
  };

  const expandToPage = () => {
    if (!eventId) return;
    onOpenChange(false);
    void navigate(`/workspaces/${workspaceId}/events/${eventId}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The base SheetContent applies `data-[side=right]:sm:max-w-sm`
          (24rem). To override, our class must match the same modifier
          signature exactly so twMerge can dedupe — a plain `sm:max-w-xl`
          loses on selector specificity. The `data-[side=right]:w-3/4`
          underneath stays fine: at desktop widths 75vw is much larger
          than max-w-xl (36rem), so the cap controls the visible width. */}
      <SheetContent
        side="right"
        // `outline-none` strips the focus-visible ring base-ui's Dialog
        // applies to the popup root when focus returns to the container
        // (e.g. after EditableTitle's input commits on Enter and unmounts,
        // the focus trap parks focus on the popup). Matches the kanban
        // card treatment for the same reason.
        className="data-[side=right]:sm:max-w-xl flex flex-col gap-0 p-0 outline-none"
      >
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {detail === null ? "Event not found" : null}
          </div>
        ) : (
          <>
            {/* Header: title + cancelled badge. The Maximize2 trigger sits
                between the title and the sheet's built-in close (top-3
                right-3) — top-3 right-12 leaves room for both. */}
            <SheetHeader className="p-4 pb-3 border-b">
              <div className="flex items-start gap-2 pr-20">
                <CalendarDaysIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                {editable ? (
                  // Wrap EditableTitle's text in SheetTitle so Radix's
                  // a11y labelling for the dialog still hooks up. We
                  // pass it through TitleSlot rather than rendering it
                  // around the whole component because EditableTitle
                  // also renders an Input in edit mode (where SheetTitle
                  // would be wrong).
                  <EditableTitle
                    value={detail.event.title}
                    onSave={(title) =>
                      saveField("Title", { eventId: detail.event._id, title })
                    }
                    TitleSlot={SheetTitle}
                  />
                ) : (
                  <SheetTitle className="text-base truncate">
                    {detail.event.title}
                  </SheetTitle>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-12"
                onClick={expandToPage}
                title="Expand to full page"
                aria-label="Expand to full page"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </SheetHeader>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              <EventDetailContent
                detail={detail}
                channels={channels}
                members={members}
                editable={editable}
                viewerInvited={!!myInvitee}
                workspaceId={workspaceId}
                saveField={saveField}
                handleAddInvitees={handleAddInvitees}
                handleSelfInvite={handleSelfInvite}
                handleRemoveInvitee={handleRemoveInvitee}
                gapClassName="gap-5"
                channelDisplay="inline"
              />
            </div>

            {/* Footer actions */}
            <div className="border-t p-3 flex flex-col gap-2">
              <JoinCallButton
                status={callStatus}
                onJoin={joinCall}
                className="w-full"
                pendingClassName="text-center"
              />

              {!isOrganizer && myInvitee && (
                <RsvpResponseGroup
                  myStatus={myInvitee.status}
                  onRespond={(s) => void handleRespond(s)}
                  className="grid grid-cols-3 gap-1.5"
                />
              )}

              {/* Cancel = hard delete with notifications. Single verb now —
                  events have no soft-delete state. */}
              {isOrganizer && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void onCancel()}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Cancel event
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
