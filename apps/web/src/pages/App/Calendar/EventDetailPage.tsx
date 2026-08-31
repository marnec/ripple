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
 * hook, same `EventDetailContent` body — so editing here is one-for-one
 * with the side panel. The only deltas are layout (wider content
 * column, larger title) and post-destroy navigation (back to the
 * calendar tab, not closing a popover).
 */

import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { useQuery } from "convex-helpers/react/cache";

import { Button } from "@ripple/ui/components/button";
import { api } from "@convex/_generated/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RippleSpinner } from "@/components/RippleSpinner";
import { HeaderSlot, MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@convex/types/routes";
import type { Id } from "@convex/_generated/dataModel";

import { EditableTitle } from "./event-detail-blocks";
import { eventLinkView } from "./event-link";
import { removeEventDialogCopy, useEventDetail } from "./event-detail-data";
import { EventDetailContent } from "./EventDetailContent";
import { JoinCallButton } from "./JoinCallButton";
import { OccurrenceDetailPage } from "./OccurrenceDetailPage";
import { RsvpResponseGroup } from "./RsvpResponseGroup";
import { useSeriesRsvp } from "./use-series-rsvp";

export function EventDetailPage() {
  const { workspaceId, eventId } = useParams<
    QueryParams & { eventId?: Id<"calendarEvents"> }
  >();
  const [searchParams] = useSearchParams();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;

  // `?on=<originalStartMs>` means the path segment is a **series** and this is
  // one occurrence of it, not an event row. The coordinate is what makes
  // "moved to Thursday" land on the right date rather than on the series.
  const view = eventLinkView(searchParams.get("on"));
  if (view.kind === "invalid") return <SomethingWentWrong />;
  if (view.kind === "occurrence") {
    return (
      <OccurrenceDetailPage
        workspaceId={workspaceId}
        seriesId={eventId as unknown as Id<"eventSeries">}
        originalStartMs={view.originalStartMs}
      />
    );
  }

  return <BareEventLink workspaceId={workspaceId} linkId={eventId} />;
}

/**
 * A link with no coordinate. It is either an event id — the overwhelming
 * majority — or a **series** id, which a notification about the pattern and an
 * `@`-mention both produce, because neither has one date to name.
 *
 * The server decides which, because only it can: an id's table is not readable
 * from the string, and asking `eventSeries.get` with an event id would be
 * refused by the argument validator before the handler ran. A series resolves
 * to whichever occurrence is next from now — the last one once it has ended —
 * so an old link is never a dead page.
 */
function BareEventLink({
  workspaceId,
  linkId,
}: {
  workspaceId: Id<"workspaces">;
  linkId: string;
}) {
  const landing = useQuery(api.eventSeries.resolveLink, { linkId });

  // Replace rather than push: the bare URL is a redirect, not a stop on the
  // way, so Back must not bounce the viewer through it again. A series with no
  // occurrence left to land on goes to the series itself — still a page about
  // the thing the link named.
  if (landing) {
    const to =
      landing.originalStartMs === null
        ? `/workspaces/${workspaceId}/events/${landing.seriesId}/series`
        : `/workspaces/${workspaceId}/events/${landing.seriesId}?on=${landing.originalStartMs}`;
    return <Navigate to={to} replace />;
  }

  // The event page cannot start loading before this answers, however much we
  // would like it to. `calendarEvents.get` takes a `v.id("calendarEvents")`,
  // and an id from another table fails argument validation on the server —
  // which is a thrown query, not an empty result, so rendering optimistically
  // crashed the page for exactly the links this component exists to serve: an
  // `@`-mention of a series and a notification about the pattern, both of
  // which are bare by design.
  if (landing === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <RippleSpinner />
      </div>
    );
  }

  // `null` is the server saying "not a series", which leaves exactly one thing
  // it can be.
  return (
    <EventDetailPageContent
      workspaceId={workspaceId}
      eventId={linkId as Id<"calendarEvents">}
    />
  );
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
    viewer,
    myInvitee,
    isOrganizer,
    editable,
    hasGuests,
    callStatus,
    saveField,
    handleRespond,
    handleCancel,
    handleAddInvitees,
    handleSelfInvite,
    handleRemoveInvitee,
  } = useEventDetail({ eventId, workspaceId });

  // An **override** is one occurrence of a series wearing an event row, and it
  // carries no invitee rows of its own — the roster belongs to the series. So
  // the answer offered on a moved Tuesday is the series' one answer, given
  // through the same hook the series and its other occurrences use. `null`
  // for every ordinary event, which answers its own invitation below.
  const seriesRsvp = useSeriesRsvp({
    seriesId: detail?.event.seriesId ?? null,
    viewerId: viewer?._id,
    organizerId: detail?.event.createdBy,
  });

  // Where to land after cancellation (= hard delete). Pop the URL back
  // to the calendar tab so the user isn't stranded on a now-stale event
  // URL.
  const calendarHref = `/workspaces/${workspaceId}/dashboard/calendar`;

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // An override is an occurrence of a repeating event wearing an event row, so
  // the removal here is a skip, not a cancellation. The copy has to say so.
  const removalCopy = removeEventDialogCopy({
    willNotifyAnyone: hasGuests,
    isOccurrenceOfSeries: detail?.event.seriesId !== undefined,
  });
  const onCancel = async () => {
    setConfirmingCancel(false);
    if (await handleCancel()) void navigate(calendarHref);
  };

  const joinCall = () => {
    void navigate(`/workspaces/${workspaceId}/events/${eventId}/videocall`);
  };

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
      {/* Desktop toolbar: a single Cancel-event action (cancellation is
          a hard delete with notifications — there is no separate
          "delete"). Mobile pushes the same action into HeaderSlot. */}
      {!isMobile && isOrganizer && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex h-8 min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingCancel(true)}
              title={removalCopy.confirmLabel}
            >
              <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
              {removalCopy.confirmLabel}
            </Button>
          </div>
        </div>
      )}

      {isMobile && isOrganizer && (
        <HeaderSlot>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmingCancel(true)}
            aria-label={removalCopy.confirmLabel}
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
          {/* Spacer */}
          <div className="h-6" />

          {/* ───── Sections ───── */}
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
            gapClassName="gap-7"
            channelDisplay="section"
          />

          {/* ───── Footer actions (Join + RSVP) — kept in the body
                 (not a sticky footer) since the page already scrolls
                 and a fixed bar would chew vertical space on mobile. */}
          <div className="mt-10 flex flex-col gap-2 border-t pt-6">
            <JoinCallButton
              status={callStatus}
              onJoin={joinCall}
              className="self-start min-w-40"
            />

            {seriesRsvp ? (
              <RsvpResponseGroup
                myStatus={seriesRsvp.myStatus}
                onRespond={(s) => void seriesRsvp.respond(s)}
                className="max-w-md"
                buttonClassName="flex-1"
              />
            ) : (
              !isOrganizer &&
              myInvitee && (
                <RsvpResponseGroup
                  myStatus={myInvitee.status}
                  onRespond={(s) => void handleRespond(s)}
                  className="max-w-md"
                  buttonClassName="flex-1"
                />
              )
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        onConfirm={() => void onCancel()}
        title={removalCopy.title}
        description={removalCopy.description}
        confirmLabel={removalCopy.confirmLabel}
        dismissLabel={removalCopy.dismissLabel}
      />
    </div>
  );
}
