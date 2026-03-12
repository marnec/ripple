import { RippleSpinner } from "@/components/RippleSpinner";
import { Separator } from "@/components/ui/separator";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import { ChannelRole } from "@shared/enums";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ChannelDangerZone } from "./ChannelDangerZone";
import { ChannelDetailsSection } from "./ChannelDetailsSection";
import { ChannelMembersSection } from "./ChannelMembersSection";

function ChannelSettingsContent({
  workspaceId,
  channelId,
}: {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels">;
}) {
  const channel = useQuery(api.channels.get, { id: channelId });
  const channelMembers = useQuery(api.channelMembers.membersByChannel, { channelId });
  const workspaceMembers = useQuery(api.workspaceMembers.membersByWorkspace, { workspaceId });
  const currentUser = useQuery(api.users.viewer);

  if (
    channel === undefined ||
    channelMembers === undefined ||
    workspaceMembers === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (channel === null || currentUser === null) {
    return <SomethingWentWrong />;
  }

  const currentMembership = channelMembers.find(
    (m) => m.userId === currentUser._id,
  );
  const isAdmin = channel.isPublic
    ? true
    : currentMembership?.role === ChannelRole.ADMIN;

  const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
  const availableMembers = workspaceMembers.filter(
    (m) => !channelMemberIds.has(m._id),
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="hidden md:block text-2xl font-bold mb-6">Channel Settings</h1>

      <ChannelDetailsSection
        channelId={channelId}
        channelName={channel.name}
        isPublic={channel.isPublic}
        isAdmin={isAdmin}
      />

      <Separator className="my-6" />

      <ChannelMembersSection
        channelId={channelId}
        isPublic={channel.isPublic}
        isAdmin={isAdmin}
        currentUserId={currentUser._id}
        channelMembers={channelMembers}
        availableMembers={availableMembers}
      />

      {isAdmin && (
        <>
          <Separator className="my-6" />
          <ChannelDangerZone
            channelId={channelId}
            workspaceId={workspaceId}
          />
        </>
      )}
    </div>
  );
}

export const ChannelSettings = () => {
  const { workspaceId, channelId } = useParams<QueryParams>();

  if (!workspaceId || !channelId) return <SomethingWentWrong />;

  return (
    <ChannelSettingsContent
      workspaceId={workspaceId}
      channelId={channelId}
    />
  );
};
