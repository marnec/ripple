import { useMutation, useQuery } from "convex/react";
import { MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
import { ChannelSelectorItem } from "./ChannelSelectorItem";
import { CreateChannelDialog } from "./CreateChannelDialog";

export interface ChannelSelectorListProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
}

export function ChannelSelectorList({
  workspaceId,
  channelId,
  onChannelSelect,
}: ChannelSelectorListProps) {
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const navigate = useNavigate();
  const deleteChannel = useMutation(api.channels.remove);

  const channels = useQuery(api.channels.listByUserMembership, {
    workspaceId: workspaceId,
  });

  const handleChannelDelete = async (id: Id<"channels">) => {
    onChannelSelect(null);
    await deleteChannel({ id });
  };

  const navigateToChannelSettings = (id: Id<"channels">) => {
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const navigateToChannelDetails = (id: Id<"channels">) => {
    void navigate(`/workspaces/${workspaceId}/channels/${id}/details`);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Channels</SidebarGroupLabel>
      <SidebarGroupAction title="Create channel" onClick={() => setShowCreateChannel(true)}>
        <MessageSquarePlusIcon />
        <span className="sr-only">Create channel</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {channels?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No channels yet</p>
        )}
        {channels?.map((channel) => (
          <ChannelSelectorItem
            key={channel._id}
            channel={channel}
            channelId={channelId}
            onChannelSelect={onChannelSelect}
            onManageChannel={navigateToChannelSettings}
            onChannelDetails={navigateToChannelDetails}
            onDeleteChannel={(id) => void handleChannelDelete(id)}
          />
        ))}
      </SidebarMenu>
      <CreateChannelDialog
        workspaceId={workspaceId}
        open={showCreateChannel}
        onOpenChange={setShowCreateChannel}
      />
    </SidebarGroup>
  );
}
