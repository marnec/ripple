import { Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SidebarMenuSubItem } from "@/components/ui/sidebar";
import { MAX_SIDEBAR_FAVORITES, RESOURCE_ROUTES, preselectFavoriteFilter } from "./sidebar-constants";
import type { ResourceType } from "./sidebar-constants";

/**
 * Renders muted placeholder rows to fill remaining favorite slots in the sidebar.
 * Each stub shows "select a favorite" with a star icon and navigates to the
 * resource-list page's favorites tab on click.
 */
export function EmptyFavoriteSlots({
  filled,
  workspaceId,
  resourceType,
}: {
  filled: number;
  workspaceId: string;
  resourceType: ResourceType;
}) {
  const navigate = useNavigate();
  const empty = Math.max(0, MAX_SIDEBAR_FAVORITES - filled);
  if (empty === 0) return null;

  const handleClick = () => {
    preselectFavoriteFilter(workspaceId, resourceType);
    void navigate(`/workspaces/${workspaceId}/${RESOURCE_ROUTES[resourceType]}`);
  };

  return (
    <>
      {Array.from({ length: empty }, (_, i) => (
        <SidebarMenuSubItem key={`empty-${i}`}>
          <div
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => e.key === "Enter" && handleClick()}
            className="flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sidebar-foreground/25 hover:bg-sidebar-accent hover:text-sidebar-foreground/40"
          >
            <Star className="size-3 shrink-0" />
            <span className="truncate text-xs italic">select a favorite</span>
          </div>
        </SidebarMenuSubItem>
      ))}
    </>
  );
}
