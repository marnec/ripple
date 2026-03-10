import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { getResourceUrl } from "@/lib/resource-urls";
import { useQuery } from "convex/react";
import { ChevronRight, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

interface RecentsSidebarSectionProps {
  workspaceId: Id<"workspaces">;
  isOpen: boolean;
  onToggle: () => void;
}

export function RecentsSidebarSection({ workspaceId, isOpen, onToggle }: RecentsSidebarSectionProps) {
  const navigate = useNavigate();
  const { isMobile, setOpen } = useSidebar();
  const recents = useQuery(api.recentActivity.listRecent, { workspaceId, limit: 5 });

  if (!recents || recents.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Recents">
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <Clock className="size-4" />
          <span className="font-medium">Recents</span>
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            {recents.map((item) => {
              const Icon = RESOURCE_TYPE_ICONS[item.resourceType as keyof typeof RESOURCE_TYPE_ICONS];

              if (item.deleted) {
                return (
                  <SidebarMenuSubItem key={item._id}>
                    <SidebarMenuSubButton render={<div className="cursor-default opacity-40" />}>
                        {Icon && <Icon className="size-3.5 shrink-0" />}
                        <span className="truncate line-through">{item.resourceName}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              }

              return (
                <SidebarMenuSubItem key={item._id}>
                  <SidebarMenuSubButton render={<div
                      onClick={() => {
                        if (isMobile) setOpen(false);
                        void navigate(getResourceUrl(workspaceId, item.resourceType, item.resourceId));
                      }}
                      className="cursor-pointer"
                    />}>
                      {Icon && <Icon className="size-3.5" />}
                      <span className="truncate">{item.resourceName}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
    </Collapsible>
  );
}
