import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, MessageCircle, User } from "lucide-react";
import { memo } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../../components/ui/sidebar";

export interface DmSelectorListProps {
  workspaceId: Id<"workspaces">;
  channelId: Id<"channels"> | undefined;
  onChannelSelect: (id: string | null) => void;
  channels?: { _id: string; _creationTime: number; name: string; workspaceId: string; type: string }[];
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

  if (!channels || channels.length === 0) return null;

  const handleSelect = (id: string) => {
    if (isMobile) setOpen(false);
    onChannelSelect(id);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
      <SidebarMenuButton tooltip="Direct Messages">
        <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
        </CollapsibleTrigger>
        <MessageCircle className="size-4" />
        <span className="font-medium">Direct Messages</span>
      </SidebarMenuButton>
      <CollapsibleContent>
        <SidebarMenuSub>
          {channels.map((dm) => (
            <SidebarMenuSubItem key={dm._id}>
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
                    className="cursor-pointer"
                  />
                }
                isActive={dm._id === channelId}
              >
                <User size={14} className="shrink-0" />
                <span className="truncate">{dm.name || "Direct Message"}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
});
