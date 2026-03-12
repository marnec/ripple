import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Cog, Hash, Lock, MoreHorizontal, Trash2 } from "lucide-react";
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
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../../components/ui/sidebar";

export interface ChannelSelectorItemProps {
  channel: Doc<"channels">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  onManageChannel: (id: Id<"channels">) => void;
  onDeleteChannel: (id: Id<"channels">) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ChannelSelectorItem({
  channelId,
  channel,
  onChannelSelect,
  onManageChannel,
  onDeleteChannel,
  className,
  style,
}: ChannelSelectorItemProps) {
  const isMobile = useIsMobile();
  const unreadCount = useQuery(api.channelReads.getUnreadCount, { channelId: channel._id });

  return (
    <SidebarMenuSubItem className={cn("group/subitem relative", className)} style={style}>
      <SidebarMenuSubButton
        render={<div onClick={() => onChannelSelect(channel._id)} className="cursor-pointer pr-6" />}
        isActive={channel._id === channelId}
      >
          <div className="flex items-end shrink-0">
            <Hash size={14} />
            <Lock className={cn("size-2.5", "-ml-0.5", channel.isPublic ? "invisible" : "")} />
          </div>
          <span className={cn("truncate", unreadCount && unreadCount > 0 && "font-semibold")}>{channel.name}</span>
          {unreadCount != null && unreadCount > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
              {unreadCount}
            </span>
          )}
      </SidebarMenuSubButton>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
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
    </SidebarMenuSubItem>
  );
}
