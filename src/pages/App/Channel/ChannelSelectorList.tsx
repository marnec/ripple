import { useMutation, useQuery } from "convex/react";
import { MessageSquare, MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "../../../components/ui/sidebar";
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
  // @ts-expect-error TS2589 deep type instantiation with Convex query
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

  const handleHeaderClick = () => {
    onChannelSelect(null);
  };

  return (
    <SidebarMenuItem className="flex h-full min-h-0 flex-col">
      <SidebarMenuButton tooltip="Channels" onClick={handleHeaderClick}>
        <MessageSquare className="size-4" />
        <span className="font-medium">Channels</span>
      </SidebarMenuButton>
      <button
        onClick={() => setShowCreateChannel(true)}
        className="absolute right-1 top-1.5 rounded-sm p-0.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
        title="Create channel"
      >
        <MessageSquarePlusIcon className="size-4" />
      </button>
      <SidebarMenuSub className="min-h-0 flex-1 overflow-y-auto">
        {channels?.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet</p>
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
      </SidebarMenuSub>
      <CreateChannelDialog
        workspaceId={workspaceId}
        open={showCreateChannel}
        onOpenChange={setShowCreateChannel}
      />
    </SidebarMenuItem>
  );
}
