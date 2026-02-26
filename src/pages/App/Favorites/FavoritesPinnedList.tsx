import { useQuery } from "convex/react";
import { FileText, Folder, PenTool, Star, Table2 } from "lucide-react";
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
import { useIsMobile } from "@/hooks/use-mobile";

const RESOURCE_ICONS = {
  document: FileText,
  diagram: PenTool,
  spreadsheet: Table2,
  project: Folder,
} as const;

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
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const favorites = useQuery(api.favorites.listPinned, { workspaceId });

  if (!favorites || favorites.length === 0) return null;

  const handleClick = (fav: { resourceType: keyof typeof RESOURCE_ROUTES; resourceId: string }) => {
    if (isMobile) setOpenMobile(false);
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
