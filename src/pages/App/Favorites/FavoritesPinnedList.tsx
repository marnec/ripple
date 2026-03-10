import { useQuery } from "convex/react";
import { Star } from "lucide-react";
import { RESOURCE_TYPE_ICONS } from "@/lib/resource-icons";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../../components/ui/sidebar";

const RESOURCE_ICONS = RESOURCE_TYPE_ICONS;

const RESOURCE_ROUTES = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  project: "projects",
} as const;

type FavoritesPinnedListProps = {
  workspaceId: Id<"workspaces">;
};

export function FavoritesPinnedList({ workspaceId }: FavoritesPinnedListProps) {
  const navigate = useNavigate();
  const { isMobile, setOpen } = useSidebar();
  const favorites = useQuery(api.favorites.listPinned, { workspaceId });

  if (!favorites || favorites.length === 0) return null;

  const handleClick = (fav: { resourceType: keyof typeof RESOURCE_ROUTES; resourceId: string }) => {
    if (isMobile) setOpen(false);
    const route = RESOURCE_ROUTES[fav.resourceType];
    void navigate(`/workspaces/${workspaceId}/${route}/${fav.resourceId}`);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>
        <Star className="mr-1 h-3.5 w-3.5" />
        Favorites
      </SidebarGroupLabel>
      <SidebarMenu>
        {favorites.map((fav: { _id: Id<"favorites">; resourceType: keyof typeof RESOURCE_ROUTES; resourceId: string; name: string }) => {
          const Icon = RESOURCE_ICONS[fav.resourceType];
          return (
            <SidebarMenuItem key={fav._id}>
              <SidebarMenuButton
                onClick={() => handleClick(fav)}
                tooltip={fav.name}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{fav.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
