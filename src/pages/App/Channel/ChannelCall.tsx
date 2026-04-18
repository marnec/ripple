import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { useParams } from "react-router-dom";
import GroupVideoCall from "../GroupVideoCall/GroupVideoCall";
import { ShareCallButton } from "./ShareCallButton";
import type { QueryParams } from "@shared/types/routes";

export const ChannelVideoCall = () => {
  const { channelId, workspaceId } = useParams<QueryParams>();

  if (!channelId || !workspaceId) {
    console.error(
      "Channel Id or Workspace Id not found. The channel Videocall should be rendered in a route where both params are available",
    );
    return <SomethingWentWrong />;
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-4 top-4 z-10">
        <ShareCallButton channelId={channelId} workspaceId={workspaceId} />
      </div>
      <GroupVideoCall channelId={channelId} workspaceId={workspaceId} />
    </div>
  );
};
