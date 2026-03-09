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
import { useAnimatedQuery } from "@/hooks/use-animated-query";
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
  const { setOpenMobile } = useSidebar();
  const liveRecents = useQuery(api.recentActivity.listRecent, { workspaceId, limit: 5 });
  const recents = useAnimatedQuery(liveRecents);

  if (!recents || recents.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} asChild>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Recents">
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <span role="button" className="shrink-0">
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
            </span>
          </CollapsibleTrigger>
          <Clock className="size-4" />
          <span className="font-medium">Recents</span>
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0">
            {recents.map((item) => {
              const Icon = RESOURCE_TYPE_ICONS[item.resourceType as keyof typeof RESOURCE_TYPE_ICONS];

              const vtProps = {
                className: "channel-vt",
                style: { viewTransitionName: `recent-${item._id}` } as React.CSSProperties,
              };

              if (item.deleted) {
                return (
                  <SidebarMenuSubItem key={item._id} {...vtProps}>
                    <SidebarMenuSubButton asChild>
                      <div className="cursor-default opacity-40">
                        {Icon && <Icon className="size-3.5 shrink-0" />}
                        <span className="truncate line-through">{item.resourceName}</span>
                      </div>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                );
              }

              return (
                <SidebarMenuSubItem key={item._id} {...vtProps}>
                  <SidebarMenuSubButton asChild>
                    <div
                      onClick={() => {
                        setOpenMobile(false);
                        void navigate(getResourceUrl(workspaceId, item.resourceType, item.resourceId));
                      }}
                      className="cursor-pointer"
                    >
                      {Icon && <Icon className="size-3.5" />}
                      <span className="truncate">{item.resourceName}</span>
                    </div>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
