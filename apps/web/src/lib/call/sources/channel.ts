import { useAction, useMutation } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

import type { CallSourcePort } from "../source-port";

/**
 * Builds a `CallSourcePort` for a channel call. Closes over the
 * Convex action + mutation refs so the resulting port carries no
 * Convex-specific dependencies — the call lifecycle hook only sees
 * the abstract port surface.
 *
 * The returned object identity is unstable across renders. That's fine:
 * `useCallSession` only treats `descriptor.resourceId` as session
 * identity, so callers can pass a freshly-built port to `enterLobby`
 * without memoization.
 */
export function useChannelCallSource(
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
): CallSourcePort {
  const joinChannelCall = useAction(api.callSessions.joinCall);
  const endSession = useMutation(api.callSessions.endSession);

  return {
    descriptor: {
      kind: "channel",
      resourceId: channelId,
      workspaceId,
      label: "Channel call",
      homePath: `/workspaces/${workspaceId}/channels/${channelId}/videocall`,
      leaveDestination: `/workspaces/${workspaceId}/channels/${channelId}`,
    },
    acquireToken: ({ userName, userImage }) =>
      joinChannelCall({ channelId, userName, userImage }),
    onAfterLeave: async ({ remainingParticipants }) => {
      // Last participant out → end the channel session so the next call
      // starts fresh. Multi-occupant rooms keep the meeting alive.
      if (remainingParticipants === 0) {
        await endSession({ channelId });
      }
    },
  };
}
