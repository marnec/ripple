/**
 * Desktop side-panel detail surface for a calendar event. The mobile
 * counterpart is `EventDetailPage` (a full route at /events/:eventId);
 * `MyCalendarTab` decides which to open based on viewport. Both consume
 * the same `useEventDetail` hook + leaf components from
 * `event-detail-blocks.tsx`, so editing here and there feels identical
 * at the field level.
 *
 * The Maximize2 button in the corner navigates to the full page —
 * mirrors the same affordance on `TaskDetailSheet`.
 */

import { useNavigate } from "react-router-dom";
import {
  CalendarDays as CalendarDaysIcon,
  Hash,
  Maximize2,
  Trash2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { Id } from "@convex/_generated/dataModel";
import {
  EditableChannel,
  EditableDateTime,
  EditableDescription,
  EditableTitle,
  InviteAdder,
  PersonRow,
  ReadDateTime,
  ReadSection,
} from "./event-detail-blocks";
import {
  RSVP_BADGE_CLASS,
  RSVP_LABEL,
  useEventDetail,
} from "./event-detail-data";

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
    hasGuests,
    callStatus,
    saveField,
    handleRespond,
    handleCancel,
    handleDelete,
    handleAddInvitees,
    handleRemoveInvitee,
  } = useEventDetail({ eventId, workspaceId });

  const onCancel = async () => {
    if (await handleCancel()) onOpenChange(false);
  };
  const onDelete = async () => {
    if (await handleDelete()) onOpenChange(false);
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
        className="data-[side=right]:sm:max-w-xl flex flex-col gap-0 p-0"
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
              {detail.event.cancelledAt !== undefined && (
                <div className="mt-1.5">
                  <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-destructive/15 text-destructive uppercase tracking-wide">
                    Cancelled
                  </span>
                </div>
              )}
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
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
              {editable ? (
                <EditableDateTime
                  startsAt={detail.event.startsAt}
                  endsAt={detail.event.endsAt}
                  onSave={(startsAt, endsAt) =>
                    saveField("Time", {
                      eventId: detail.event._id,
                      startsAt,
                      endsAt,
                    })
                  }
                />
              ) : (
                <ReadDateTime
                  startsAt={detail.event.startsAt}
                  endsAt={detail.event.endsAt}
                />
              )}

              {editable ? (
                <EditableChannel
                  value={detail.event.channelId ?? ""}
                  channels={channels ?? []}
                  onSave={(channelId) =>
                    saveField("Channel", {
                      eventId: detail.event._id,
                      channelId: channelId
                        ? (channelId as Id<"channels">)
                        : null,
                    })
                  }
                />
              ) : detail.channelName && detail.event.channelId ? (
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm hover:underline self-start"
                  onClick={() => {
                    void navigate(
                      `/workspaces/${workspaceId}/channels/${detail.event.channelId}`,
                    );
                  }}
                >
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Linked to</span>
                  <span className="font-medium">{detail.channelName}</span>
                </button>
              ) : null}

              {editable ? (
                <EditableDescription
                  value={detail.event.description ?? ""}
                  onSave={(description) =>
                    saveField("Description", {
                      eventId: detail.event._id,
                      description,
                    })
                  }
                />
              ) : detail.event.description ? (
                <ReadSection label="Description">
                  <p className="text-sm whitespace-pre-wrap">
                    {detail.event.description}
                  </p>
                </ReadSection>
              ) : null}

              <ReadSection label="Organizer">
                <PersonRow
                  name={detail.organizer.name ?? detail.organizer.email ?? "Unknown"}
                  image={detail.organizer.image}
                />
              </ReadSection>

              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Invitees
                  </p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {detail.invitees.length}
                  </span>
                </div>
                {detail.invitees.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No one invited yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.invitees.map((inv) => (
                      <li
                        key={inv._id}
                        className="group flex items-center gap-2 text-sm"
                      >
                        <PersonRow
                          name={
                            inv.userName ??
                            inv.guestName ??
                            inv.guestEmail ??
                            "Invitee"
                          }
                          image={inv.userImage}
                          guest={!inv.userId}
                          subtitle={inv.userId ? inv.userEmail : "Guest"}
                        />
                        <span
                          className={cn(
                            "ml-auto text-[11px] px-1.5 py-0.5 rounded font-medium",
                            RSVP_BADGE_CLASS[inv.status],
                          )}
                        >
                          {RSVP_LABEL[inv.status]}
                        </span>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveInvitee(inv._id)}
                            aria-label={`Remove ${inv.userName ?? inv.guestEmail ?? "invitee"}`}
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {editable && (
                  <InviteAdder
                    members={members ?? []}
                    existingUserIds={
                      new Set(
                        detail.invitees
                          .map((i) => i.userId)
                          .filter((id): id is Id<"users"> => !!id),
                      )
                    }
                    existingGuestEmails={
                      new Set(
                        detail.invitees
                          .map((i) => i.guestEmail)
                          .filter((e): e is string => !!e),
                      )
                    }
                    organizerId={detail.event.createdBy}
                    onSubmit={handleAddInvitees}
                  />
                )}
              </section>
            </div>

            {/* Footer actions */}
            <div className="border-t p-3 flex flex-col gap-2">
              {callStatus === "open" && detail.event.cancelledAt === undefined && (
                <Button onClick={joinCall} className="w-full">
                  <Video className="h-4 w-4 mr-1.5" />
                  Join call
                </Button>
              )}
              {callStatus === "pending" && (
                <p className="text-xs text-center text-muted-foreground">
                  Join opens 5 minutes before the event.
                </p>
              )}

              {!isOrganizer && myInvitee && detail.event.cancelledAt === undefined && (
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    variant={myInvitee.status === "accepted" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("accepted")}
                  >
                    Going
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "tentative" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("tentative")}
                  >
                    Maybe
                  </Button>
                  <Button
                    type="button"
                    variant={myInvitee.status === "declined" ? "default" : "outline"}
                    size="sm"
                    onClick={() => void handleRespond("declined")}
                  >
                    Decline
                  </Button>
                </div>
              )}

              {/* Organizer destructive actions. Cancel = guest-aware
                  soft-delete; Delete = hard remove (rejects when there
                  are still un-notified guests). The pair is documented
                  in README's calendar block. */}
              {isOrganizer && (
                <div className="flex items-center gap-1.5">
                  {detail.event.cancelledAt === undefined && hasGuests && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => void onCancel()}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Cancel event
                    </Button>
                  )}
                  {(!hasGuests || detail.event.cancelledAt !== undefined) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-destructive hover:text-destructive"
                      onClick={() => void onDelete()}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Delete event
                    </Button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
