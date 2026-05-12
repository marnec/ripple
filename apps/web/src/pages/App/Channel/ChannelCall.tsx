import { useNavigate, useParams } from "react-router-dom";

import { CallSurface } from "@/components/call/CallSurface";
import { useChannelCallSource } from "@/lib/call/sources/channel";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { Id } from "@convex/_generated/dataModel";
import type { QueryParams } from "@ripple/shared/types/routes";

import { FollowParticipantOverlay } from "./FollowParticipantOverlay";
import { ShareCallButton } from "./ShareCallButton";

/**
 * Channel call route. Mounts the polymorphic `<CallSurface>` with a
 * channel source and channel-specific chrome (share-call button in the
 * controls bar + follow-mode overlay on participant tiles). Lifecycle,
 * busy handling, lobby, and meeting UI all live in `CallSurface` —
 * shared with the calendar event surface.
 */
export const ChannelVideoCall = () => {
  const { channelId, workspaceId } = useParams<QueryParams>();
  if (!channelId || !workspaceId) {
    console.error(
      "Channel Id or Workspace Id not found. The channel videocall route requires both params.",
    );
    return <SomethingWentWrong />;
  }

  return (
    <ChannelVideoCallContent
      channelId={channelId}
      workspaceId={workspaceId}
    />
  );
};

function ChannelVideoCallContent({
  channelId,
  workspaceId,
}: {
  channelId: Id<"channels">;
  workspaceId: Id<"workspaces">;
}) {
  const navigate = useNavigate();
  const source = useChannelCallSource(channelId, workspaceId);

  return (
    <CallSurface
      source={source}
      resourceId={channelId}
      back={{
        label: "Back to channel",
        onClick: () =>
          void navigate(`/workspaces/${workspaceId}/channels/${channelId}`),
      }}
      controlsTrailing={
        <ShareCallButton channelId={channelId} workspaceId={workspaceId} />
      }
      renderParticipantOverlay={(participant) => (
        <FollowParticipantOverlay participant={participant} />
      )}
    />
  );
}
