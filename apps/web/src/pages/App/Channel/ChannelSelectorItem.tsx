import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import {
  Cog,
  Eye,
  EyeOff,
  Hash,
  Lock,
  LogOut,
  MoreHorizontal,
  Video,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../../components/ui/sidebar";
import { LeaveChannelDialog } from "./LeaveChannelDialog";
import { removeFromKnownChannels } from "@/hooks/use-acknowledged-channels";

/** Channel shape as returned by the sidebar query (extends Doc with isHidden). */
export type SidebarChannel = Doc<"channels"> & { isHidden: boolean };

export interface ChannelSelectorItemProps {
  channel: SidebarChannel;
  channelId: Id<"channels"> | undefined;
  /** Boolean "something new" signal — we deliberately don't show a count. */
  hasUnread: boolean;
  onChannelSelect: (id: string | null) => void;
  onManageChannel: (id: Id<"channels">) => void;
  onStartCall: (id: Id<"channels">) => void;
  /** Called immediately before any user-initiated mutation that changes the
   *  channels list (hide/unhide/leave). Tells the acknowledged-channels hook
   *  that the next list update is expected, so it absorbs the change silently
   *  instead of rendering "+N / -N" pending-change badges. */
  onSelfChangeIntent?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ChannelSelectorItem({
  channelId,
  channel,
  hasUnread,
  onChannelSelect,
  onManageChannel,
  onStartCall,
  onSelfChangeIntent,
  className,
  style,
}: ChannelSelectorItemProps) {
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const hideChannel = useMutation(api.channelVisibility.hideChannel);
  const unhideChannel = useMutation(api.channelVisibility.unhideChannel);

  const handleHide = () => {
    // Flag the upcoming list change as self-initiated so the acknowledged
    // channels hook doesn't show a pending "-1" badge.
    onSelfChangeIntent?.();
    hideChannel({ channelId: channel._id }).catch((error: unknown) => {
      toast.error("Couldn't hide channel", {
        description:
          error instanceof ConvexError ? String(error.data) : "Please try again",
      });
    });
  };

  const handleUnhide = () => {
    onSelfChangeIntent?.();
    unhideChannel({ channelId: channel._id }).catch((error: unknown) => {
      toast.error("Couldn't unhide channel", {
        description:
          error instanceof ConvexError ? String(error.data) : "Please try again",
      });
    });
  };

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
          <span className={cn(
            "truncate",
            hasUnread && "font-semibold",
            channel.isHidden && "italic text-muted-foreground",
          )}>{channel.name}</span>
          {hasUnread && (
            <span
              className="ml-auto size-2 shrink-0 rounded-full bg-primary"
              aria-label="Unread messages"
            />
          )}
      </SidebarMenuSubButton>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
            <MoreHorizontal className="size-3.5" />
        </ResponsiveDropdownMenuTrigger>
        <ResponsiveDropdownMenuContent className="w-52 rounded-lg">
          <ResponsiveDropdownMenuItem onSelect={() => onStartCall(channel._id)}>
            <Video className="text-muted-foreground" />
            <span>Join call</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem onSelect={() => onManageChannel(channel._id)}>
            <Cog className="text-muted-foreground" />
            <span>Manage channel</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          {channel.isHidden ? (
            <ResponsiveDropdownMenuItem onSelect={handleUnhide}>
              <Eye className="text-muted-foreground" />
              <span>Show in sidebar</span>
            </ResponsiveDropdownMenuItem>
          ) : channel.type === "open" ? (
            <ResponsiveDropdownMenuItem onSelect={handleHide}>
              <EyeOff className="text-muted-foreground" />
              <span>Hide from sidebar</span>
            </ResponsiveDropdownMenuItem>
          ) : (
            // closed
            <ResponsiveDropdownMenuItem onSelect={() => setShowLeaveDialog(true)}>
              <LogOut className="text-destructive" />
              <span className="text-destructive">Leave channel</span>
            </ResponsiveDropdownMenuItem>
          )}
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
      <LeaveChannelDialog
        open={showLeaveDialog}
        onOpenChange={setShowLeaveDialog}
        channelId={channel._id}
        channelName={channel.name}
        onLeft={() => removeFromKnownChannels(channel.workspaceId, channel._id)}
      />
    </SidebarMenuSubItem>
  );
}
