import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useAcknowledgedChannels } from "@/hooks/use-acknowledged-channels";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Hash, MessageSquare, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

const channelsRemoveRef = makeFunctionReference<
  "mutation",
  { id: Id<"channels"> },
  null
>("channels:remove");

const channelsListByUserMembershipRef = makeFunctionReference<
  "query",
  { workspaceId: Id<"workspaces"> },
  Doc<"channels">[]
>("channels:listByUserMembership");
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

export interface ChannelSelectorListProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function ChannelSelectorList({
  workspaceId,
  channelId,
  onChannelSelect,
  isOpen,
  onToggle,
}: ChannelSelectorListProps) {
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [pendingDeleteChannel, setPendingDeleteChannel] = useState<{ id: Id<"channels">; name: string } | null>(null);
  const { state: sidebarState, openMobile, setOpenMobile, isMobile } = useSidebar();
  const isChannelListVisible = isOpen && (isMobile ? openMobile : sidebarState === "expanded");

  const navigate = useNavigate();
  const deleteChannel = useMutation(channelsRemoveRef);

  const channels = useQuery(channelsListByUserMembershipRef, {
    workspaceId: workspaceId,
  });

  const channelEntries = useMemo(
    () => channels?.map((c) => ({ id: c._id, name: c.name })),
    [channels],
  );
  const { displayList, newCount, removedCount, acknowledgeAll, acknowledgeOne, autoAcknowledgeNext } =
    useAcknowledgedChannels(workspaceId, channelEntries, isChannelListVisible);

  // Build a map from id → Doc for live channels
  const channelMap = useMemo(() => {
    const m = new Map<string, Doc<"channels">>();
    if (channels) for (const c of channels) m.set(c._id, c);
    return m;
  }, [channels]);

  const handleChannelDeleteRequest = (id: Id<"channels">) => {
    const channel = channelMap.get(id);
    setPendingDeleteChannel({ id, name: channel?.name ?? "this channel" });
  };

  const handleChannelDeleteConfirm = async () => {
    if (!pendingDeleteChannel) return;
    autoAcknowledgeNext();
    onChannelSelect(null);
    await deleteChannel({ id: pendingDeleteChannel.id });
    setPendingDeleteChannel(null);
  };

  const navigateToChannelSettings = (id: Id<"channels">) => {
    setOpenMobile(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
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
              {displayList.map((item) => {
                if (item.removed) {
                  return (
                    <motion.div
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
                    </motion.div>
                  );
                }

                const channel = channelMap.get(item.id);
                if (!channel) return null;

                return (
                  <motion.div
                    key={channel._id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <ChannelSelectorItem
                      channel={channel}
                      channelId={channelId}
                      onChannelSelect={(id) => {
                        if (id) {
                          const ch = channelMap.get(id);
                          acknowledgeOne(id, ch?.name ?? "");
                        }
                        onChannelSelect(id);
                      }}
                      onManageChannel={navigateToChannelSettings}
                      onDeleteChannel={handleChannelDeleteRequest}
                    />
                  </motion.div>
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
        <ResponsiveDialog
          open={!!pendingDeleteChannel}
          onOpenChange={(open) => { if (!open) setPendingDeleteChannel(null); }}
        >
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Delete channel?</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Are you sure you want to delete &ldquo;{pendingDeleteChannel?.name}&rdquo;? All messages will be permanently lost. This action cannot be undone.
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setPendingDeleteChannel(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleChannelDeleteConfirm()}>
                Delete
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
    </Collapsible>
  );
}
