import { cn } from "@/lib/utils";
import { Cog, Hash, Lock, MoreHorizontal, Video } from "lucide-react";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../../components/ui/sidebar";

export interface ChannelSelectorItemProps {
  channel: Doc<"channels">;
  channelId: Id<"channels"> | undefined;
  unreadCount: number;
  onChannelSelect: (id: string | null) => void;
  onManageChannel: (id: Id<"channels">) => void;
  onStartCall: (id: Id<"channels">) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ChannelSelectorItem({
  channelId,
  channel,
  unreadCount,
  onChannelSelect,
  onManageChannel,
  onStartCall,
  className,
  style,
}: ChannelSelectorItemProps) {

  return (
    <SidebarMenuSubItem className={cn("group/subitem relative", className)} style={style}>
      <SidebarMenuSubButton
        render={<div
          onClick={() => onChannelSelect(channel._id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onChannelSelect(channel._id);
            }
          }}
          className="cursor-pointer pr-6"
        />}
        isActive={channel._id === channelId}
      >
          <div className="flex items-end shrink-0">
            <Hash size={14} />
            <Lock className={cn("size-2.5", "-ml-0.5", channel.type === "open" ? "invisible" : "")} />
          </div>
          <span className={cn("truncate", unreadCount > 0 && "font-semibold")}>{channel.name}</span>
          {unreadCount > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
              {unreadCount}
            </span>
          )}
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-48 rounded-lg">
          <ResponsiveDropdownMenuItem onSelect={() => onStartCall(channel._id)}>
            <Video className="text-muted-foreground" />
            <span>Join call</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onSelect={() => onManageChannel(channel._id)}>
            <Cog className="text-muted-foreground" />
            <span>Manage channel</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
    </SidebarMenuSubItem>
  );
}
