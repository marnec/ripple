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
import { useLocalRecents } from "@/hooks/use-local-recents";
import { AnimatePresence, m } from "framer-motion";
import { memo } from "react";
import { ChevronRight, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";

interface RecentsSidebarSectionProps {
  workspaceId: Id<"workspaces">;
  isOpen: boolean;
  onToggle: () => void;
}

export const RecentsSidebarSection = memo(function RecentsSidebarSection({ workspaceId, isOpen, onToggle }: RecentsSidebarSectionProps) {
  const navigate = useNavigate();
  const { isMobile, setOpen } = useSidebar();
  const recents = useLocalRecents(workspaceId, 5);

  if (recents.length === 0) return null;

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
            <AnimatePresence initial={false}>
              {recents.map((item) => {
                const Icon = RESOURCE_TYPE_ICONS[item.resourceType as keyof typeof RESOURCE_TYPE_ICONS];

                return (
                  <m.div
                    key={item.resourceId}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton render={<div
                          onClick={() => {
                            if (isMobile) setOpen(false);
                            void navigate(getResourceUrl(workspaceId, item.resourceType, item.resourceId));
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (isMobile) setOpen(false);
                              void navigate(getResourceUrl(workspaceId, item.resourceType, item.resourceId));
                            }
                          }}
                          className="cursor-pointer"
                        />}>
                          {Icon && <Icon className="size-3.5" />}
                          <span className="truncate">{item.resourceName}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </m.div>
                );
              })}
            </AnimatePresence>
          </SidebarMenuSub>
        </CollapsibleContent>
    </Collapsible>
  );
});
