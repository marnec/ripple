import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

const channelsRemoveRef = makeFunctionReference<
  "mutation",
  { id: Id<"channels"> },
  null
>("channels:remove");

const channelsListByUserMembershipRef = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  Doc<"channels">[]
>("channels:listByUserMembership");
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
  const deleteChannel = useMutation(channelsRemoveRef);

  const channels = useQuery(channelsListByUserMembershipRef, {
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
