/**
 * Full-page detail surface for a calendar event. Mounted at
 * `/workspaces/:workspaceId/events/:eventId`. The mobile destination
 * for an event tap (set in MyCalendarTab) and the desktop "expand from
 * sheet" target (the Maximize2 button on EventDetailSheet).
 *
 * The shell mirrors `TaskDetailPage`'s convention: desktop gets its own
 * top toolbar bar with destructive actions; mobile pushes the same
 * actions into HeaderSlot so the global header stays in charge of chrome.
 *
 * Content composition is identical to the sheet — same `useEventDetail`
 * hook, same Editable* / Read* leaves — so editing here is one-for-one
 * with the side panel. The only deltas are layout (wider content
 * column, larger title) and post-destroy navigation (back to the
 * calendar tab, not closing a popover).
 */

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Hash,
  Trash2,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { RippleSpinner } from "@/components/RippleSpinner";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { cn } from "@/lib/utils";
import type { QueryParams } from "@ripple/shared/types/routes";
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

export function EventDetailPage() {
  const { workspaceId, eventId } = useParams<
    QueryParams & { eventId?: Id<"calendarEvents"> }
  >();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;
  return <EventDetailPageContent workspaceId={workspaceId} eventId={eventId} />;
}

function EventDetailPageContent({
  workspaceId,
  eventId,
}: {
  workspaceId: Id<"workspaces">;
  eventId: Id<"calendarEvents">;
}) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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

  // Where to land after a destroy. Pop the URL back to the calendar
  // tab — both Cancel (which leaves a tombstone) and Delete (which
  // wipes the resource) want the user out of the now-stale event URL.
  const calendarHref = `/workspaces/${workspaceId}/dashboard/calendar`;

  const onCancel = async () => {
    if (await handleCancel()) void navigate(calendarHref);
  };
  const onDelete = async () => {
    if (await handleDelete()) void navigate(calendarHref);
  };

  const joinCall = () => {
    void navigate(`/workspaces/${workspaceId}/events/${eventId}/videocall`);
  };

  const hasInvitees = !!detail && detail.invitees.length > 0;
  const existingUserIds = useMemo(
    () =>
      new Set(
        detail?.invitees
          .map((i) => i.userId)
          .filter((id): id is Id<"users"> => !!id) ?? [],
      ),
    [detail?.invitees],
  );
  const existingGuestEmails = useMemo(
    () =>
      new Set(
        detail?.invitees
          .map((i) => i.guestEmail)
          .filter((e): e is string => !!e) ?? [],
      ),
    [detail?.invitees],
  );

  // Loading: matches TaskDetailPage's RippleSpinner full-screen pattern.
  // Once Convex resolves the query we render content (or ResourceDeleted
  // if it returned null). We deliberately don't show the page chrome
  // before content is ready — that would just thrash the layout.
  if (detail === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  // `detail === null` happens if the query throws "Event not found"
  // (e.g. cross-tab delete, hand-typed URL with a stale id). Convex's
  // useQuery surfaces thrown errors as null on the helper-cache version
  // we use here. The dedicated empty surface gives the user a path back.
  if (detail === null) {
    return <ResourceDeleted resourceType="event" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Desktop toolbar: actions live on a flat bar above the content,
          mirroring TaskDetailPage. Mobile gets the same actions injected
          into the global HeaderSlot so the page body stays uncluttered.
          We render Cancel/Delete only for organisers; non-organisers
          have no destructive actions. */}
      {!isMobile && isOrganizer && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex h-8 min-w-0 items-center gap-2">
            {detail.event.cancelledAt === undefined && hasGuests && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onCancel()}
                title="Cancel event (notifies guests)"
              >
                <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
                Cancel event
              </Button>
            )}
            {(!hasGuests || detail.event.cancelledAt !== undefined) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onDelete()}
                title="Delete event"
              >
                <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
                Delete event
              </Button>
            )}
          </div>
        </div>
      )}

      {isMobile && isOrganizer && (
        <HeaderSlot>
          {/* Single destructive button on mobile: it dispatches based on
              event state. The full Cancel-vs-Delete distinction is more
              nuance than a phone header has room for — mobile users get
              the safer choice (cancel-with-notify) when guests are still
              around, otherwise plain delete. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (detail.event.cancelledAt === undefined && hasGuests) {
                void onCancel();
              } else {
                void onDelete();
              }
            }}
            aria-label="Cancel or delete event"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </HeaderSlot>
      )}
      <MobileHeaderTitle name={detail.event.title} />

      {/* Body — single column with a reasonable max width. The page
          intentionally goes wider than the sheet (max-w-3xl vs the
          sheet's 36rem) so the When triple + invitee list have room to
          breathe on a 27" monitor. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="w-full mx-auto px-4 md:px-8 pt-4 md:pt-8 max-w-3xl pb-10">
          {/* ───── Title block ───── */}
          <div className="flex items-start gap-3 mb-1">
            {editable ? (
              <EditableTitle
                value={detail.event.title}
                onSave={(title) =>
                  saveField("Title", { eventId: detail.event._id, title })
                }
                size="lg"
              />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {detail.event.title}
              </h1>
            )}
          </div>
          {detail.event.cancelledAt !== undefined && (
            <div className="mb-4">
              <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-destructive/15 text-destructive uppercase tracking-wide">
                Cancelled
              </span>
            </div>
          )}

          {/* Spacer */}
          <div className="h-6" />

          {/* ───── Sections ───── */}
          <div className="flex flex-col gap-7">
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
              <ReadSection
                icon={<Hash className="h-3.5 w-3.5" />}
                label="Channel"
              >
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
                  <span className="font-medium">{detail.channelName}</span>
                </button>
              </ReadSection>
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
                rows={6}
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

            {/* ───── Invitees ───── */}
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Invitees
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {detail.invitees.length}
                </span>
              </div>
              {!hasInvitees ? (
                <p className="text-xs text-muted-foreground">
                  No one invited yet.
                </p>
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
                  existingUserIds={existingUserIds}
                  existingGuestEmails={existingGuestEmails}
                  organizerId={detail.event.createdBy}
                  onSubmit={handleAddInvitees}
                />
              )}
            </section>
          </div>

          {/* ───── Footer actions (Join + RSVP) — kept in the body
                 (not a sticky footer) since the page already scrolls
                 and a fixed bar would chew vertical space on mobile. */}
          <div className="mt-10 flex flex-col gap-2 border-t pt-6">
            {callStatus === "open" && detail.event.cancelledAt === undefined && (
              <Button onClick={joinCall} className="self-start min-w-40">
                <Video className="h-4 w-4 mr-1.5" />
                Join call
              </Button>
            )}
            {callStatus === "pending" && (
              <p className="text-xs text-muted-foreground">
                Join opens 5 minutes before the event.
              </p>
            )}

            {!isOrganizer && myInvitee && detail.event.cancelledAt === undefined && (
              <div className="flex items-center gap-1.5 max-w-md">
                <Button
                  type="button"
                  variant={myInvitee.status === "accepted" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => void handleRespond("accepted")}
                >
                  Going
                </Button>
                <Button
                  type="button"
                  variant={myInvitee.status === "tentative" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => void handleRespond("tentative")}
                >
                  Maybe
                </Button>
                <Button
                  type="button"
                  variant={myInvitee.status === "declined" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => void handleRespond("declined")}
                >
                  Decline
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

