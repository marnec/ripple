import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { QueryParams } from "@/types";
import { useNavigate, useParams } from "react-router-dom";
import { ChannelSelector } from "./Channel/ChannelSelector";
import { NavUser } from "./UserMenu";
import { WorkspaceSelector } from "./Workspace/WorkspaceSelector";

export function AppSidebar() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();

  const handleChannelSelect = (id: string) => {
    navigate(`channel/${id}`);
  };

  const handleWorkspaceSelect = (id: string) => {
    navigate(`/workspaces/${id}`);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <WorkspaceSelector onWorkspaceSelect={handleWorkspaceSelect} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {workspaceId && (
            <ChannelSelector
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
