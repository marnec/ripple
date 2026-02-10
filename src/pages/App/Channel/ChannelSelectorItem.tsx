import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Cog, Hash, Info, Lock, MoreHorizontal, Trash2 } from "lucide-react";
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
  SidebarMenuButton,
  SidebarMenuItem
} from "../../../components/ui/sidebar";

export interface ChannelSelectorItemProps {
  channel: Doc<"channels">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  onManageChannel: (id: Id<"channels">) => void;
  onChannelDetails: (id: Id<"channels">) => void;
  onDeleteChannel: (id: Id<"channels">) => void;
}

export function ChannelSelectorItem({
  channelId,
  channel,
  onChannelSelect,
  onManageChannel,
  onChannelDetails,
  onDeleteChannel,
}: ChannelSelectorItemProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        variant={channel._id === channelId ? "outline" : "default"}
        onClick={() => onChannelSelect(channel._id)}
      >
        <div className="flex flex-row items-center">
          <div className="flex flex-row items-end">
            <Hash size={18} />
            <Lock className={cn("size-3", "-ml-1", channel.isPublic ? "invisible" : "")} />
          </div>
          <div>{channel.name}</div>
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
          <DropdownMenuItem onClick={() => onChannelDetails(channel._id)}>
            <Info className="text-muted-foreground" />
            <span>Details</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onManageChannel(channel._id)}>
            <Cog className="text-muted-foreground" />
            <span>Manage channel</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onDeleteChannel(channel._id)}>
            <Trash2 className="text-muted-foreground" />
            <span>Delete channel</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
