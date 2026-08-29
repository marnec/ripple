import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ChevronRight,
  Cog,
  Eye,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  Plus,
  User,
  Video,
} from "lucide-react";
import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { exitCopy } from "@/lib/channel-exit";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { preloadChatContainer } from "../preload";
import { ChannelCallIndicator } from "./ChannelCallIndicator";
import { CreateDmDialog } from "./CreateDmDialog";
import { useChannelCalls } from "@/hooks/use-channel-calls";

type DmChannel = {
  _id: string;
  _creationTime: number;
  name: string;
  workspaceId: string;
  kind: string;
  visibility: string;
  isHidden: boolean;
};

export interface DmSelectorListProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  channels?: DmChannel[];
  isOpen: boolean;
  onToggle: () => void;
}

export const DmSelectorList = memo(function DmSelectorList({
  workspaceId,
  channelId,
  onChannelSelect,
  channels,
  isOpen,
  onToggle,
}: DmSelectorListProps) {
  const { isMobile, setOpen } = useSidebar();
  const navigate = useNavigate();
  const dismissChannel = useMutation(api.channelDismissal.dismissChannel);
  const restoreChannel = useMutation(api.channelDismissal.restoreChannel);
  // A DM is a channel, so its call reports through the same presence field.
  const channelCalls = useChannelCalls();
  const [showCreateDm, setShowCreateDm] = useState(false);

  // The section renders whether or not the viewer has any conversations. It
  // used to disappear at zero, which hid the only entry point from precisely
  // the person who has never started one.
  const dms = channels ?? [];
  const isLoading = channels === undefined;

  const handleSelect = (id: string) => {
    if (isMobile) setOpen(false);
    onChannelSelect(id);
  };

  // A DM is a channel, so it has the same settings page and the same call
  // route — the menu offers them under the words a conversation uses.
  const navigateToDmSettings = (dmId: string) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${dmId}/settings`);
  };

  const navigateToVideoCall = (dmId: string) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${dmId}/videocall`);
  };

  // Takes the conversation rather than its id so the copy can be derived from
  // it, the way `ChannelSelectorItem` does — one call shape in both menus.
  const handleClose = (dm: DmChannel) => {
    const dmId = dm._id as Id<"channels">;
    dismissChannel({ channelId: dmId })
      .then(() => {
        // Closing the conversation you are reading has to take you out of it,
        // or the page shows a conversation the sidebar says you do not have.
        // Only on success: a rejected dismissal changes nothing.
        if (dmId === channelId) onChannelSelect(null);
      })
      .catch((error: unknown) => {
        toast.error(exitCopy(dm).dismissFailed, {
          description:
            error instanceof ConvexError ? String(error.data) : "Please try again",
        });
      });
  };

  const handleReopen = (dm: DmChannel) => {
    restoreChannel({ channelId: dm._id as Id<"channels"> }).catch((error: unknown) => {
      toast.error(exitCopy(dm).restoreFailed, {
        description:
          error instanceof ConvexError ? String(error.data) : "Please try again",
      });
    });
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={onToggle}
      render={<SidebarMenuItem />}
      onMouseEnter={() => void preloadChatContainer()}
      onFocus={() => void preloadChatContainer()}
    >
      <SidebarMenuButton tooltip="Direct Messages">
        <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
        </CollapsibleTrigger>
        <MessageCircle className="size-4" />
        <span className="font-medium">DMs</span>
      </SidebarMenuButton>
      {/* Reveal-on-hover matches the Channels section — except with no
          conversations, where the action is the only thing in the section and
          hiding it would restore the problem this section's always-rendering
          was meant to fix. */}
      <SidebarMenuAction showOnHover={dms.length > 0} onClick={() => setShowCreateDm(true)}>
        <Plus />
        <span className="sr-only">New Direct Message</span>
      </SidebarMenuAction>
      <CollapsibleContent>
        <SidebarMenuSub>
          {!isLoading && dms.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No conversations yet</p>
          )}
          {dms.map((dm) => (
            <SidebarMenuSubItem key={dm._id} className="group/subitem relative">
              <SidebarMenuSubButton
                render={
                  <div
                    onClick={() => handleSelect(dm._id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelect(dm._id);
                      }
                    }}
                    className="cursor-pointer pr-6"
                  />
                }
                isActive={dm._id === channelId}
              >
                <User size={14} className="shrink-0" />
                <span className={cn(
                  "truncate",
                  dm.isHidden && "italic text-muted-foreground",
                )}>{dm.name || "Direct Message"}</span>
                {(channelCalls.get(dm._id)?.length ?? 0) > 0 && (
                  <ChannelCallIndicator
                    participants={channelCalls.get(dm._id) ?? []}
                    className="ml-auto"
                  />
                )}
              </SidebarMenuSubButton>
              <ResponsiveDropdownMenu>
                <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
                  <MoreHorizontal className="size-3.5" />
                </ResponsiveDropdownMenuTrigger>
                <ResponsiveDropdownMenuContent className="w-52 rounded-lg">
                  <ResponsiveDropdownMenuItem onSelect={() => navigateToVideoCall(dm._id)}>
                    <Video className="text-muted-foreground" />
                    <span>Join call</span>
                  </ResponsiveDropdownMenuItem>
                  <ResponsiveDropdownMenuItem onSelect={() => navigateToDmSettings(dm._id)}>
                    <Cog className="text-muted-foreground" />
                    <span>Manage conversation</span>
                  </ResponsiveDropdownMenuItem>
                  <ResponsiveDropdownMenuSeparator />
                  {dm.isHidden ? (
                    <ResponsiveDropdownMenuItem onSelect={() => handleReopen(dm)}>
                      <Eye className="text-muted-foreground" />
                      <span>{exitCopy(dm).restore}</span>
                    </ResponsiveDropdownMenuItem>
                  ) : (
                    <ResponsiveDropdownMenuItem onSelect={() => handleClose(dm)}>
                      <EyeOff className="text-muted-foreground" />
                      <span>{exitCopy(dm).dismiss}</span>
                    </ResponsiveDropdownMenuItem>
                  )}
                </ResponsiveDropdownMenuContent>
              </ResponsiveDropdownMenu>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
      <CreateDmDialog
        workspaceId={workspaceId}
        open={showCreateDm}
        onOpenChange={setShowCreateDm}
        existingConversationLabels={new Set(dms.map((dm) => dm.name))}
      />
    </Collapsible>
  );
});
