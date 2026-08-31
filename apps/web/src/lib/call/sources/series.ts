import { useAction } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import type { CallSourcePort } from "../source-port";

/**
 * Builds a `CallSourcePort` for one occurrence of a **series**.
 *
 * Every occurrence meets in the same room, so the port carries the series id
 * and no occurrence coordinate: the backend resolves which occurrence is
 * happening from the clock, which is what lets a join link shared once keep
 * working for the life of the series. The `?on=` the occurrence page carries
 * is how the *client* knows the path segment names a series — it is not part
 * of the join itself.
 *
 * `kind` stays `"event"` on purpose. It is the discriminant the call chrome
 * reads to pick affordances and copy ("you're already in an event call"), and
 * an occurrence is an event in every way that chrome cares about. Session
 * identity is `resourceId`, which is the series' own id, so a series call and
 * an event call are still two different calls.
 */
export function useSeriesCallSource(
  seriesId: Id<"eventSeries">,
  workspaceId: Id<"workspaces">,
  occurrenceStartMs: number,
): CallSourcePort {
  const joinSeriesCall = useAction(api.eventSeries.joinSeriesCall);
  const homePath = `/workspaces/${workspaceId}/events/${seriesId}/videocall?on=${occurrenceStartMs}`;

  return {
    descriptor: {
      kind: "event",
      resourceId: seriesId,
      workspaceId,
      label: "Event call",
      homePath,
      leaveDestination: `/workspaces/${workspaceId}/dashboard/calendar`,
    },
    acquireToken: async ({ userName, userImage }) => {
      const { channelId, ...token } = await joinSeriesCall({
        seriesId,
        userName,
        userImage,
      });
      // A channel-hosted series runs in the channel's meeting, so presence
      // reports the channel — the same signal a direct channel join publishes.
      return { ...token, channelId: channelId ?? undefined };
    },
  };
}
