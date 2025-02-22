import { useQuery } from "convex/react";
import { MessageSquarePlusIcon } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../ui/sidebar";
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

  const channels = useQuery(api.channels.list, {
    workspaceId: workspaceId as Id<"workspaces">,
  });

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Channels</SidebarGroupLabel>
      <SidebarGroupAction title="Create channel" onClick={() => setShowCreateChannel(true)}>
        <MessageSquarePlusIcon />
        <span className="sr-only">Create channel</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {channels?.map((channel) => (
          <ChannelSelectorItem
            key={channel._id}
            channel={channel}
            channelId={channelId}
            onChannelSelect={onChannelSelect}
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
