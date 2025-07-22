import { useIsMobile } from "@/hooks/use-mobile";
import { useMutation } from "convex/react";
import { Folder, Info, MoreHorizontal, Trash2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuItem
} from "../../../components/ui/sidebar";
import { ChannelSelectorButton } from "./ChannelSelectorButton";

export interface ChannelSelectorItemProps {
  channel: Doc<"channels">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  onManageChannel: (id: string) => void;
  onChannelDetails: (id: string) => void;
}

export function ChannelSelectorItem({
  channelId,
  channel,
  onChannelSelect,
  onManageChannel,
  onChannelDetails,
}: ChannelSelectorItemProps) {
  const isMobile = useIsMobile();
  const deleteChannel = useMutation(api.channels.remove);

  const handleChannelDelete = async (id: Id<"channels">) => {
    await deleteChannel({ id });

    onChannelSelect(null);
  };

  return (
    <SidebarMenuItem>
      <ChannelSelectorButton channelId={channelId} channel={channel} onClick={onChannelSelect} />
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
          <DropdownMenuItem onClick={() => onChannelDetails(channel._id)}>
            <Info className="text-muted-foreground" />
            <span>Details</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageChannel(channel._id)}>
            <Folder className="text-muted-foreground" />
            <span>Manage channel</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleChannelDelete(channel._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete channel</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
