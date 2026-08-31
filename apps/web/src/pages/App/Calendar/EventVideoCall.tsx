import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { CallSurface } from "@/components/call/CallSurface";
import { useEventCallSource } from "@/lib/call/sources/event";
import { useSeriesCallSource } from "@/lib/call/sources/series";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryParams } from "@convex/types/routes";

/**
 * Authenticated calendar-event call route. The polymorphic
 * `<CallSurface>` (shared with the channel surface) handles every
 * branch — lobby, busy screen, joining, joined meeting, error. Events
 * have no surface-specific chrome: no share button, no follow mode.
 */
export function EventVideoCall() {
  const { workspaceId, eventId } = useParams<
    QueryParams & { eventId?: string }
  >();
  const [searchParams] = useSearchParams();
  if (!workspaceId || !eventId) return <SomethingWentWrong />;

  // `?on=<originalStartMs>` means the path segment names a **series** and this
  // is one of its occurrences — the same discriminator `EventDetailPage` uses.
  // The coordinate does not reach the backend: every occurrence meets in the
  // one room, and which occurrence is happening is the clock's answer.
  const on = searchParams.get("on");
  if (on !== null) {
    const originalStartMs = Number(on);
    if (!Number.isFinite(originalStartMs)) return <SomethingWentWrong />;
    return (
      <SeriesVideoCallContent
        workspaceId={workspaceId}
        seriesId={eventId as Id<"eventSeries">}
        originalStartMs={originalStartMs}
      />
    );
  }

  return (
    <EventVideoCallContent
      workspaceId={workspaceId}
      eventId={eventId as Id<"calendarEvents">}
    />
  );
}

function SeriesVideoCallContent({
  workspaceId,
  seriesId,
  originalStartMs,
}: {
  workspaceId: Id<"workspaces">;
  seriesId: Id<"eventSeries">;
  originalStartMs: number;
}) {
  const navigate = useNavigate();
  const source = useSeriesCallSource(seriesId, workspaceId, originalStartMs);

  return (
    <CallSurface
      source={source}
      resourceId={seriesId}
      back={{
        label: "Back to calendar",
        onClick: () =>
          void navigate(`/workspaces/${workspaceId}/dashboard/calendar`),
      }}
    />
  );
}

function EventVideoCallContent({
  workspaceId,
  eventId,
}: {
  workspaceId: Id<"workspaces">;
  eventId: Id<"calendarEvents">;
}) {
  const navigate = useNavigate();
  const source = useEventCallSource(eventId, workspaceId);

  return (
    <CallSurface
      source={source}
      resourceId={eventId}
      back={{
        label: "Back to calendar",
        onClick: () =>
          void navigate(`/workspaces/${workspaceId}/dashboard/calendar`),
      }}
    />
  );
}
