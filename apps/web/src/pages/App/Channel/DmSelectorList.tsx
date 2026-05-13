import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import {
  ChevronRight,
  Eye,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  User,
} from "lucide-react";
import { memo } from "react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuTrigger,
} from "../../../components/ui/responsive-dropdown-menu";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { preloadChatContainer } from "../preload";

type DmChannel = {
  _id: string;
  _creationTime: number;
  name: string;
  workspaceId: string;
  type: string;
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
  channelId,
  onChannelSelect,
  channels,
  isOpen,
  onToggle,
}: DmSelectorListProps) {
  const { isMobile, setOpen } = useSidebar();
  const hideChannel = useMutation(api.channelVisibility.hideChannel);
  const unhideChannel = useMutation(api.channelVisibility.unhideChannel);

  if (!channels || channels.length === 0) return null;

  const handleSelect = (id: string) => {
    if (isMobile) setOpen(false);
    onChannelSelect(id);
  };

  const handleClose = (dmId: Id<"channels">) => {
    hideChannel({ channelId: dmId }).catch((error: unknown) => {
      toast.error("Couldn't close conversation", {
        description:
          error instanceof ConvexError ? String(error.data) : "Please try again",
      });
    });
  };

  const handleReopen = (dmId: Id<"channels">) => {
    unhideChannel({ channelId: dmId }).catch((error: unknown) => {
      toast.error("Couldn't reopen conversation", {
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
      <CollapsibleContent>
        <SidebarMenuSub>
          {channels.map((dm) => (
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
              </SidebarMenuSubButton>
              <ResponsiveDropdownMenu>
                <ResponsiveDropdownMenuTrigger render={<button className="absolute right-1 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-sidebar-foreground/60 md:opacity-0 hover:bg-sidebar-accent hover:text-sidebar-foreground md:group-hover/subitem:opacity-100 data-popup-open:opacity-100" />}>
                  <MoreHorizontal className="size-3.5" />
                </ResponsiveDropdownMenuTrigger>
                <ResponsiveDropdownMenuContent className="w-52 rounded-lg">
                  {dm.isHidden ? (
                    <ResponsiveDropdownMenuItem onSelect={() => handleReopen(dm._id as Id<"channels">)}>
                      <Eye className="text-muted-foreground" />
                      <span>Reopen conversation</span>
                    </ResponsiveDropdownMenuItem>
                  ) : (
                    <ResponsiveDropdownMenuItem onSelect={() => handleClose(dm._id as Id<"channels">)}>
                      <EyeOff className="text-muted-foreground" />
                      <span>Close conversation</span>
                    </ResponsiveDropdownMenuItem>
                  )}
                </ResponsiveDropdownMenuContent>
              </ResponsiveDropdownMenu>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
});
