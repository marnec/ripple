import { useAction } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import type { CallSourcePort } from "../source-port";

/**
 * Builds a `CallSourcePort` for a calendar event call. Mirrors
 * `useChannelCallSource` — a thin glue layer between the polymorphic
 * lifecycle and the event-specific Convex action.
 *
 * The leave destination is the calendar dashboard rather than the event
 * page itself: after a call ends there's no in-call UI on the event
 * page worth lingering on, and the calendar is where the user usually
 * came from.
 *
 * No `onAfterLeave` hook — event calls don't have a "last participant
 * ends the session" semantic. The Cloudflare meeting is keyed off the
 * event's join window and is recreated server-side for each new join
 * after the prior session expired.
 */
export function useEventCallSource(
  eventId: Id<"calendarEvents">,
  workspaceId: Id<"workspaces">,
): CallSourcePort {
  const joinEventCall = useAction(api.calendarEvents.joinEventCall);

  return {
    descriptor: {
      kind: "event",
      resourceId: eventId,
      workspaceId,
      label: "Event call",
      homePath: `/workspaces/${workspaceId}/events/${eventId}/videocall`,
      leaveDestination: `/workspaces/${workspaceId}/dashboard/calendar`,
    },
    acquireToken: ({ userName, userImage }) =>
      joinEventCall({ eventId, userName, userImage }),
  };
}
