import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { useParams } from "react-router-dom";
import GroupVideoCall from "../GroupVideoCall/GroupVideoCall";
import { QueryParams } from "@shared/types/routes";

export const ChannelVideoCall = () => {
  const { channelId, workspaceId } = useParams<QueryParams>();

  if (!channelId || !workspaceId) {
    console.error(
      "Channel Id or Workspace Id not found. The channel Videocall should be rendered in a route where both params are available",
    );
    return <SomethingWentWrong />;
  }

  return <GroupVideoCall channelId={channelId} workspaceId={workspaceId} />;
};
