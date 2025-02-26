import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LoadingSpinner } from "../ui/loading-spinner";
import { ChannelMembershipSelection } from "./ChannelMembershipSelection";
import { ChannelMembershipRole } from "./ChannelMembershipRole";

type ChannelMembershipProps = {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels">;
};

const ChannelMembership = ({ workspaceId, channelId }: ChannelMembershipProps) => {
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const channelMembers = useQuery(api.channelMembers.membersByChannel, { channelId });

  return (
    <>
      {workspaceMembers && channelMembers ? (
        <div className="flex flex-col space-y-3">
          <h2 className="h2 ">Channel members</h2>
          <ChannelMembershipSelection
            channelMembers={channelMembers}
            workspaceMembers={workspaceMembers}
            channelId={channelId}
          />
          <ChannelMembershipRole channelMembers={channelMembers} />
        </div>
      ) : (
        <LoadingSpinner />
      )}
    </>
  );
};

export const ChannelSettings = () => {
  const { workspaceId, channelId } = useParams<QueryParams>();

  if (!workspaceId || !channelId) return <SomethingWentWrong />;

  return (
    <div className="container mt-5">
      <ChannelMembership workspaceId={workspaceId} channelId={channelId} />
    </div>
  );
};
