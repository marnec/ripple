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
  User,
  Video,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { exitAction, isDirectMessage, isPrivateChannel } from "@ripple/shared/channel";
import { conversationNoun, exitCopy, LEAVE_COPY } from "@/lib/channel-exit";
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
import { ChannelCallIndicator } from "./ChannelCallIndicator";
import type { ChannelCallParticipant } from "@/hooks/use-channel-calls";

/** Conversation shape as returned by the sidebar query (a Doc plus isHidden). */
export type SidebarChannel = Doc<"channels"> & { isHidden: boolean };

export interface ConversationSelectorItemProps {
  channel: SidebarChannel;
  channelId: Id<"channels"> | undefined;
  /** Boolean "something new" signal — we deliberately don't show a count. */
  hasUnread: boolean;
  /** Members currently in this channel's call. Empty when no call is live. */
  callParticipants?: ChannelCallParticipant[];
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

/**
 * One row in a sidebar conversation list — a channel or a direct message.
 *
 * There is no kind branch in the props: the icon, the padlock, the menu's exit
 * arm and its wording all come from the row itself, through `exitAction` and
 * `exitCopy`. The direct-message half of this used to be a second copy inlined
 * in `DmSelectorList` — same button, same keyboard handler, same 200-character
 * trigger class, different nouns.
 */
export function ConversationSelectorItem({
  channelId,
  channel,
  hasUnread,
  callParticipants,
  onChannelSelect,
  onManageChannel,
  onStartCall,
  onSelfChangeIntent,
  className,
  style,
}: ConversationSelectorItemProps) {
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const dismissChannel = useMutation(api.channelDismissal.dismissChannel);
  const restoreChannel = useMutation(api.channelDismissal.restoreChannel);

  // A channel only reaches this list through `channelMembers` or by being
  // public, so a private one here is always one the viewer is a member of.
  const exit = exitAction(channel, { isMember: true });
  const isDm = isDirectMessage(channel);
  const copy = exitCopy(channel);

  const handleHide = () => {
    // Flag the upcoming list change as self-initiated so the acknowledged
    // channels hook doesn't show a pending "-1" badge.
    onSelfChangeIntent?.();
    dismissChannel({ channelId: channel._id })
      .then(() => {
        // You cannot be left sitting in a channel you just took out of your
        // own sidebar — the page would show a channel the sidebar says you
        // do not have. Only on success: a rejected dismissal changes nothing.
        if (channel._id === channelId) onChannelSelect(null);
      })
      .catch((error: unknown) => {
        toast.error(copy.dismissFailed, {
          description:
            error instanceof ConvexError ? String(error.data) : "Please try again",
        });
      });
  };

  const handleUnhide = () => {
    onSelfChangeIntent?.();
    restoreChannel({ channelId: channel._id }).catch((error: unknown) => {
      toast.error(copy.restoreFailed, {
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
            {isDm ? <User size={14} /> : <Hash size={14} />}
            {/* The padlock marks a *private channel*. It used to be spelled
                `isPublicChannel(c) ? "invisible" : ""`, whose complement
                includes direct messages — reusing that here would have put a
                padlock beside every conversation. `isPrivateChannel` is the
                predicate that means what the icon means. */}
            {!isDm && (
              <Lock className={cn("size-2.5", "-ml-0.5", isPrivateChannel(channel) ? "" : "invisible")} />
            )}
          </div>
          <span className={cn(
            "truncate",
            hasUnread && "font-semibold",
            channel.isHidden && "italic text-muted-foreground",
          )}>{channel.name || "Direct Message"}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {callParticipants && callParticipants.length > 0 && (
              <ChannelCallIndicator participants={callParticipants} />
            )}
            {hasUnread && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                aria-label="Unread messages"
              />
            )}
          </div>
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
            <span>Manage {conversationNoun(channel)}</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuSeparator />
          {/* The exit arm. `exit` is the whole decision: this used to read
              "hidden? unhide : public? hide : leave", whose final branch was
              safe only because `AppSidebar` had filtered DMs out one module
              away — the fallthrough said "closed" in a comment rather than in
              a predicate. */}
          {channel.isHidden ? (
            <ResponsiveDropdownMenuItem onSelect={handleUnhide}>
              <Eye className="text-muted-foreground" />
              <span>{copy.restore}</span>
            </ResponsiveDropdownMenuItem>
          ) : exit === "dismiss" ? (
            <ResponsiveDropdownMenuItem onSelect={handleHide}>
              <EyeOff className="text-muted-foreground" />
              <span>{copy.dismiss}</span>
            </ResponsiveDropdownMenuItem>
          ) : exit === "leave" ? (
            <ResponsiveDropdownMenuItem onSelect={() => setShowLeaveDialog(true)}>
              <LogOut className="text-destructive" />
              <span className="text-destructive">{LEAVE_COPY.action}</span>
            </ResponsiveDropdownMenuItem>
          ) : null}
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
