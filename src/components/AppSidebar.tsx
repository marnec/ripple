import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { QueryParams } from "@/types";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { ChannelSelector } from "./Channel/ChannelSelector";
import { NavUser } from "./UserMenu";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";

export function AppSidebar() {
  const { workspaceId, channelId } = useParams<QueryParams>();
  const navigate = useNavigate();

  // Get all workspaces
  const workspaces = useQuery(api.workspaces.list);
  // Get active workspace details
  const activeWorkspace = useQuery(
    api.workspaces.get,
    workspaceId ? { id: workspaceId } : "skip",
  );

  const handleChannelSelect = (id: string) => {
    navigate(`channel/${id}`);
  };

  const handleWorkspaceSelect = (id: string) => {
    navigate(`/workspace/${id}`);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        {workspaces && (
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspace={activeWorkspace || undefined}
            handleWorkspaceSelect={handleWorkspaceSelect}
          />
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {workspaceId && (
            <ChannelSelector
              channelId={channelId}
              workspaceId={workspaceId}
              onChannelSelect={handleChannelSelect}
            />
          )}
        </SidebarGroup>
        <SidebarGroup />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
