import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAcknowledgedChannels } from "@/hooks/use-acknowledged-channels";
import { partitionSection, type ConversationSection } from "@/lib/conversation-section";

import { useQuery } from "convex-helpers/react/cache";
import { AnimatePresence, m } from "framer-motion";
import { ChevronRight, Eye, EyeOff, Hash, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { ConversationSelectorItem } from "./ConversationSelectorItem";
import { useChannelCalls } from "@/hooks/use-channel-calls";
import { SIDEBAR_ELEMENT_FADEIN_DELAY } from "../Resources/sidebar-constants";
import { preloadChatContainer } from "../preload";

/**
 * Everything that differs between the two sidebar sections. Everything not in
 * here is the list, and the list is one implementation.
 *
 * The Channels and DMs sections were two modules of ~230 lines each. Four
 * blocks were copied verbatim — the collapsible shell, the row button with its
 * keyboard handler, the 200-character dropdown trigger class, the
 * dismiss/restore handlers — and five capabilities had diverged for no stated
 * reason: only channels badged unread, only channels animated, only channels
 * had the hidden toggle, only DMs guarded their empty state behind a loading
 * check. None of those five was a decision; they are where the copy-paste
 * stopped.
 */
export interface ConversationSectionConfig {
  /** Which acknowledgment store this section owns, and the partition it renders. */
  section: ConversationSection;
  /** Header icon and label. */
  icon: LucideIcon;
  label: string;
  tooltip: string;
  /** Shown when the section has nothing in it. */
  emptyText: string;
  /** Screen-reader label on the `+` action. */
  createLabel: string;
  /**
   * Clicking the header. Channels navigates to the browse page; a direct
   * message has no browsable index, so the DMs header carries no destination.
   */
  onHeaderClick?: () => void;
  /**
   * The `+` action reveals on hover, except where hiding it would leave the
   * section empty *and* actionless — which is the state of someone who has
   * never started a conversation.
   */
  alwaysShowCreate?: boolean;
  /**
   * The creation dialog, supplied by the caller so this module never learns
   * the two dialogs' differing props.
   */
  renderCreateDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Call before the resulting list change arrives, so it lands silently. */
    onCreated: () => void;
    /** This section's conversations, for dialogs that need to know them. */
    conversations: SidebarConversation[];
  }) => React.ReactNode;
}

/**
 * Structurally what `workspaceSidebarData.get` returns. Declared rather than
 * inferred because `Id<"channels">` is not assignable from the context's
 * inferred return type; the cast below is the one adapter, in one place, and
 * not repeated per section the way the two lists each repeated it.
 */
export interface SidebarConversation {
  _id: string;
  _creationTime: number;
  name: string;
  workspaceId: string;
  kind: string;
  visibility: string;
  isHidden: boolean;
}

export interface ConversationSelectorListProps {
  config: ConversationSectionConfig;
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  /** This section's conversations only — already partitioned by kind. */
  conversations?: SidebarConversation[];
  isOpen: boolean;
  onToggle: () => void;
}

export const ConversationSelectorList = memo(function ConversationSelectorList({
  config,
  workspaceId,
  channelId,
  onChannelSelect,
  conversations: conversationsProp,
  isOpen,
  onToggle,
}: ConversationSelectorListProps) {
  const [showCreate, setShowCreate] = useState(false);
  // Per section, so revealing hidden conversations in one does not reveal them
  // in the other. This used to be one server-side flag shared by both.
  const [includeHidden, setIncludeHidden] = useState(false);
  const { state: sidebarState, open: sidebarOpen, isMobile, setOpen } = useSidebar();
  const isListVisible = isOpen && (isMobile ? sidebarOpen : sidebarState === "expanded");

  const navigate = useNavigate();

  const all = conversationsProp as unknown as
    | (Doc<"channels"> & { isHidden: boolean })[]
    | undefined;
  const isLoading = all === undefined;

  const { visible, hiddenCount } = partitionSection(all, { includeHidden });

  const channelIds = visible.map((c) => c._id).slice(0, 50);
  const unreadStatus = useQuery(
    api.channelReads.getUnreadStatus,
    channelIds.length > 0 ? { channelIds } : "skip",
  );
  const unreadSet = (() => {
    const s = new Set<string>();
    unreadStatus?.forEach(({ channelId, hasUnread }) => {
      if (hasUnread) s.add(channelId);
    });
    return s;
  })();

  // No subscription of its own: the workspace presence socket is already open
  // (one room for the whole workspace), so this is a read of a map in memory.
  const channelCalls = useChannelCalls();

  const entries = isLoading ? undefined : visible.map((c) => ({ id: c._id, name: c.name }));
  const { displayList, newCount, removedCount, acknowledgeAll, acknowledgeOne, autoAcknowledgeNext } =
    useAcknowledgedChannels(workspaceId, config.section, entries, isListVisible);

  const byId = (() => {
    const m = new Map<string, Doc<"channels"> & { isHidden: boolean }>();
    for (const c of visible) m.set(c._id, c);
    return m;
  })();

  const navigateToSettings = (id: Id<"channels">) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const navigateToVideoCall = (id: Id<"channels">) => {
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/videocall`);
  };

  const handleSelect = (id: string | null) => {
    if (isMobile && id) setOpen(false);
    onChannelSelect(id);
  };

  const hasPendingChanges = newCount > 0 || removedCount > 0;

  const handleHeaderClick = () => {
    if (hasPendingChanges) acknowledgeAll();
    config.onHeaderClick?.();
  };

  const HeaderIcon = config.icon;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={onToggle}
      render={<SidebarMenuItem />}
      onMouseEnter={() => void preloadChatContainer()}
      onFocus={() => void preloadChatContainer()}
    >
        <SidebarMenuButton tooltip={config.tooltip} onClick={handleHeaderClick}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <HeaderIcon className="size-4" />
          <span className="font-medium">{config.label}</span>
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
        {hiddenCount > 0 && (
          // Sits left of the Plus action. Always visible (not showOnHover)
          // because its presence is the only cue there is anything hidden.
          <SidebarMenuAction
            className="right-7 text-muted-foreground"
            onClick={() => {
              autoAcknowledgeNext();
              setIncludeHidden((prev) => !prev);
            }}
          >
            {includeHidden ? <EyeOff /> : <Eye />}
            <span className="sr-only">
              {includeHidden
                ? `Hide hidden ${config.label.toLowerCase()}`
                : `Show ${hiddenCount} hidden`}
            </span>
          </SidebarMenuAction>
        )}
        <SidebarMenuAction
          showOnHover={!config.alwaysShowCreate || visible.length > 0}
          onClick={() => setShowCreate(true)}
        >
          <Plus />
          <span className="sr-only">{config.createLabel}</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub>
            {/* Guarded on `isLoading`, so an empty section does not flash
                "No channels yet" before the first query result lands. Only the
                DM list used to do this. */}
            {!isLoading && displayList.length === 0 && newCount === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{config.emptyText}</p>
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

                const conversation = byId.get(item.id);
                if (!conversation) return null;

                return (
                  <m.div
                    key={conversation._id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <ConversationSelectorItem
                      className="animate-fade-in"
                      style={{ animationDelay: `${idx * SIDEBAR_ELEMENT_FADEIN_DELAY}ms`, animationFillMode: "backwards" }}
                      channel={conversation}
                      channelId={channelId}
                      hasUnread={unreadSet.has(conversation._id)}
                      callParticipants={channelCalls.get(conversation._id)?.participants}
                      onChannelSelect={(id) => {
                        if (id) acknowledgeOne(id, byId.get(id)?.name ?? "");
                        handleSelect(id);
                      }}
                      onManageChannel={navigateToSettings}
                      onStartCall={navigateToVideoCall}
                      onSelfChangeIntent={autoAcknowledgeNext}
                    />
                  </m.div>
                );
              })}
            </AnimatePresence>
          </SidebarMenuSub>
        </CollapsibleContent>
        {config.renderCreateDialog({
          open: showCreate,
          onOpenChange: setShowCreate,
          onCreated: autoAcknowledgeNext,
          conversations: conversationsProp ?? [],
        })}
    </Collapsible>
  );
});
