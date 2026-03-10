import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAcknowledgedChannels } from "@/hooks/use-acknowledged-channels";
import { useAnimatedQuery } from "@/hooks/use-animated-query";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ChevronRight, Hash, MessageSquare, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
  // Suppress view transitions while the dialog is animating closed.
  // Base UI's onOpenChangeComplete fires after exit animations finish,
  // so we know the portal is fully unmounted before allowing transitions.
  const [dialogInDom, setDialogInDom] = useState(false);
  const handleDialogOpenChangeComplete = useCallback((open: boolean) => {
    setDialogInDom(open);
  }, []);

  const navigate = useNavigate();
  const deleteChannel = useMutation(channelsRemoveRef);

  const channels = useQuery(channelsListByUserMembershipRef, {
    workspaceId: workspaceId,
  });

  const channelEntries = useMemo(
    () => channels?.map((c) => ({ id: c._id, name: c.name })),
    [channels],
  );
  const { displayList: rawDisplayList, newCount, removedCount, acknowledgeAll, acknowledgeOne, autoAcknowledgeNext } =
    useAcknowledgedChannels(workspaceId, channelEntries);
  const displayList = useAnimatedQuery(rawDisplayList, undefined, dialogInDom);

  // Build a map from id → Doc for live channels
  const channelMap = useMemo(() => {
    const m = new Map<string, Doc<"channels">>();
    if (channels) for (const c of channels) m.set(c._id, c);
    return m;
  }, [channels]);

  const handleChannelDelete = async (id: Id<"channels">) => {
    autoAcknowledgeNext();
    onChannelSelect(null);
    await deleteChannel({ id });
  };

  const navigateToChannelSettings = (id: Id<"channels">) => {
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const navigateToChannelDetails = (id: Id<"channels">) => {
    void navigate(`/workspaces/${workspaceId}/channels/${id}/details`);
  };

  const hasPendingChanges = newCount > 0 || removedCount > 0;

  const handleHeaderClick = () => {
    if (hasPendingChanges) acknowledgeAll();
    onChannelSelect(null);
  };

  const handleCreateChannel = () => {
    autoAcknowledgeNext();
    setDialogInDom(true);
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
            {displayList.map((item) => {
              const vtStyle = { viewTransitionName: `channel-${item.id}` } as React.CSSProperties;

              if (item.removed) {
                return (
                  <SidebarMenuSubItem
                    key={item.id}
                    className={cn("channel-vt")}
                    style={vtStyle}
                  >
                    <SidebarMenuSubButton render={<div className="cursor-default opacity-40" />}>
                        <Hash size={14} className="shrink-0" />
                        <span className="truncate line-through">{item.name || "unknown"}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              }

              const channel = channelMap.get(item.id);
              if (!channel) return null;

              return (
                <ChannelSelectorItem
                  key={channel._id}
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
                  onChannelDetails={navigateToChannelDetails}
                  onDeleteChannel={(id) => void handleChannelDelete(id)}
                  className="channel-vt"
                  style={vtStyle}
                />
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
        <CreateChannelDialog
          workspaceId={workspaceId}
          open={showCreateChannel}
          onOpenChange={setShowCreateChannel}
          onOpenChangeComplete={handleDialogOpenChangeComplete}
        />
    </Collapsible>
  );
}
