import { Folder, Hash, MoreHorizontal, Trash2 } from "lucide-react";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { Id, Doc } from "../../../convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export interface ChannelSelectorItemProps {
  channel: Doc<"channels">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
}



export function ChannelSelectorItem({
  channelId,
  channel,
  onChannelSelect,
}: ChannelSelectorItemProps) {
  const isMobile = useIsMobile();
  const deleteChannel = useMutation(api.channels.remove);

  const handleChannelDelete = async (id: Id<"channels">) =>  {
    deleteChannel({ id: channel._id })

    onChannelSelect(null)
    
  }

  return (
    <SidebarMenuItem>
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
          <DropdownMenuItem onClick={() => handleChannelDelete(channel._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete channel</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
