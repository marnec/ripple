import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "convex/react";
import { Folder, Hash, MessageSquarePlusIcon, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { CreateChannelDialog } from "./CreateChannelDialog";

export interface ChannelSelectorProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string) => void;
}

export function ChannelSelector({
  workspaceId,
  channelId,
  onChannelSelect
}: ChannelSelectorProps) {
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const isMobile = useIsMobile();
  const channels = useQuery(api.channels.list, {
    workspaceId: workspaceId as Id<"workspaces">,
  });

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Channels</SidebarGroupLabel>
        <SidebarGroupAction
         title="Create channel"  onClick={() => setShowCreateChannel(true)}>
          <MessageSquarePlusIcon /> 
          <span className="sr-only">Create channel</span>
        </SidebarGroupAction>
      <SidebarMenu>
        {channels?.map((channel) => (
          <SidebarMenuItem key={channel.name}>
            <SidebarMenuButton
              asChild
              variant={channel._id === channelId ? "outline" : "default"}
              onClick={() => onChannelSelect(channel._id)}
            >
              <div>
                <Hash /> {channel.name}
              </div>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover>
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuItem>
                  <Folder className="text-muted-foreground" />
                  <span>Manage channel (Coming soon)</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Trash2 className="text-muted-foreground" />
                  <span>Delete channel (Coming soon)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
      <CreateChannelDialog workspaceId={workspaceId} open={showCreateChannel} onOpenChange={setShowCreateChannel} /> 
    </SidebarGroup>
  );
}
