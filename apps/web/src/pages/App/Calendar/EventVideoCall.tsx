import { useNavigate, useParams } from "react-router-dom";

import { CallSurface } from "@/components/call/CallSurface";
import { useEventCallSource } from "@/lib/call/sources/event";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryParams } from "@ripple/shared/types/routes";

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
  if (!workspaceId || !eventId) return <SomethingWentWrong />;

  return (
    <EventVideoCallContent
      workspaceId={workspaceId}
      eventId={eventId as Id<"calendarEvents">}
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
