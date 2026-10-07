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
import { useQuery } from "convex-helpers/react/cache";
import { AnimatePresence, m } from "framer-motion";
import { ChevronRight, Star } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

interface FavoritesSidebarSectionProps {
  workspaceId: Id<"workspaces">;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * The viewer's starred resources, above Recents. Starring *is* pinning — there
 * is no separate pin concept — so the star on any document, diagram,
 * spreadsheet or project header is how something gets here. Server-side
 * (`favorites` table), so pins follow the user across devices, unlike Recents.
 */
export function FavoritesSidebarSection({ workspaceId, isOpen, onToggle }: FavoritesSidebarSectionProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile, setOpen } = useSidebar();
  const favorites = useQuery(api.favorites.listPinned, { workspaceId });

  if (!favorites || favorites.length === 0) return null;

  const open = (url: string) => {
    if (isMobile) setOpen(false);
    void navigate(url);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Favorites">
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <Star className="size-4" />
          <span className="font-medium">Favorites</span>
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            <AnimatePresence initial={false}>
              {favorites.map((item) => {
                const Icon = RESOURCE_TYPE_ICONS[item.resourceType];
                const url = getResourceUrl(workspaceId, item.resourceType, item.resourceId);
                // A project's URL is its Tasks tab, but any of its tabs
                // counts as being "in" it.
                const isActive = location.pathname.startsWith(
                  item.resourceType === "project" ? url.replace(/\/tasks$/, "") : url,
                );

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
                      <SidebarMenuSubButton
                        isActive={isActive}
                        render={<div
                          onClick={() => open(url)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              open(url);
                            }
                          }}
                          className="cursor-pointer"
                        />}>
                          {Icon && <Icon className="size-3.5" />}
                          <span className="truncate">{item.name}</span>
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
}
