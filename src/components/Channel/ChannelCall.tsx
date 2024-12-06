import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { useParams } from "react-router-dom";
import GroupVideoCall from "../GroupVideoCall/GroupVideoCall";

export const ChannelVideoCall = () => {
  const { channelId } = useParams();

  if (!channelId) {
    console.error(
      "Channel Id not found. The channel Videocall should be rendered in a route where the :channelId param si available",
    );
    return <SomethingWentWrong />;
  }

  return <GroupVideoCall channelId={channelId} />;
};
