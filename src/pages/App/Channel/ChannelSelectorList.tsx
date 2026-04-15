import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAcknowledgedChannels } from "@/hooks/use-acknowledged-channels";

import { useQuery } from "convex-helpers/react/cache";
import { AnimatePresence, m } from "framer-motion";
import { ChevronRight, Hash, MessageSquare, Plus } from "lucide-react";
import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { ChannelSelectorItem } from "./ChannelSelectorItem";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { SIDEBAR_ELEMENT_FADEIN_DELAY } from "../Resources/sidebar-constants";

export interface ChannelSelectorListProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  channels?: { _id: string; _creationTime: number; name: string; workspaceId: string; type: string }[];
  isOpen: boolean;
  onToggle: () => void;
}

export const ChannelSelectorList = memo(function ChannelSelectorList({
  workspaceId,
  channelId,
  onChannelSelect,
  channels: channelsProp,
  isOpen,
  onToggle,
}: ChannelSelectorListProps) {
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const { state: sidebarState, open: sidebarOpen, isMobile, setOpen } = useSidebar();
  const isChannelListVisible = isOpen && (isMobile ? sidebarOpen : sidebarState === "expanded");

  const navigate = useNavigate();

  const channels = channelsProp as unknown as Doc<"channels">[] | undefined;

  const channelIds = channels?.map((c) => c._id).slice(0, 50) ?? [];
  const unreadCounts = useQuery(
    api.channelReads.getUnreadCounts,
    channelIds.length > 0 ? { channelIds } : "skip",
  );
  const unreadMap = (() => {
    const m = new Map<string, number>();
    unreadCounts?.forEach(({ channelId, count }) => m.set(channelId, count));
    return m;
  })();

  const channelEntries = channels?.map((c) => ({ id: c._id, name: c.name }));
  const { displayList, newCount, removedCount, acknowledgeAll, acknowledgeOne, autoAcknowledgeNext } =
    useAcknowledgedChannels(workspaceId, channelEntries, isChannelListVisible);

  // Build a map from id → Doc for live channels
  const channelMap = (() => {
    const m = new Map<string, Doc<"channels">>();
    if (channels) for (const c of channels) m.set(c._id, c);
    return m;
  })();

  const navigateToChannelSettings = (id: Id<"channels">) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const navigateToVideoCall = (id: Id<"channels">) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/videocall`);
  };


  const hasPendingChanges = newCount > 0 || removedCount > 0;

  const handleHeaderClick = () => {
    if (hasPendingChanges) acknowledgeAll();
    onChannelSelect(null);
  };

  const handleCreateChannel = () => {
    setShowCreateChannel(true);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Channels" onClick={handleHeaderClick}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <MessageSquare className="size-4" />
          <span className="font-medium">Channels</span>
          {hasPendingChanges && (
            <span className="ml-auto flex items-center gap-1 pointer-events-none">
              {newCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  +{newCount}
                </span>
              )}
              {removedCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                  -{removedCount}
                </span>
              )}
            </span>
          )}
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={handleCreateChannel}>
          <Plus />
          <span className="sr-only">New Channel</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub>
            {displayList.length === 0 && newCount === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet</p>
            )}
            <AnimatePresence initial={false}>
              {displayList.map((item, idx) => {
                if (item.removed) {
                  return (
                    <m.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton render={<div className="cursor-default opacity-40" />}>
                            <Hash size={14} className="shrink-0" />
                            <span className="truncate line-through">{item.name || "unknown"}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </m.div>
                  );
                }

                const channel = channelMap.get(item.id);
                if (!channel) return null;

                return (
                  <m.div
                    key={channel._id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <ChannelSelectorItem
                      className="animate-fade-in"
                      style={{ animationDelay: `${idx * SIDEBAR_ELEMENT_FADEIN_DELAY}ms`, animationFillMode: "backwards" }}
                      channel={channel}
                      channelId={channelId}
                      unreadCount={unreadMap.get(channel._id) ?? 0}
                      onChannelSelect={(id) => {
                        if (id) {
                          const ch = channelMap.get(id);
                          acknowledgeOne(id, ch?.name ?? "");
                        }
                        onChannelSelect(id);
                      }}
                      onManageChannel={navigateToChannelSettings}
                      onStartCall={navigateToVideoCall}
                    />
                  </m.div>
                );
              })}
            </AnimatePresence>
          </SidebarMenuSub>
        </CollapsibleContent>
        <CreateChannelDialog
          workspaceId={workspaceId}
          open={showCreateChannel}
          onOpenChange={setShowCreateChannel}
          onChannelCreated={autoAcknowledgeNext}
        />
    </Collapsible>
  );
});
