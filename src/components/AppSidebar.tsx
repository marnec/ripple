import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import usePushNotifications from "@/hooks/use-push-notifications";
import { QueryParams } from "@shared/types/routes";
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { useQueries, useQuery } from "convex/react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { NavUser } from "./UserMenu";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";

export const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  const { workspaceId, channelId, documentId } = useParams<QueryParams>();

  const { subscribeUser } = usePushNotifications();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string | null) => {
    console.log(location)
    if (!id) {
      navigate(`/workspace/${workspaceId}`);
    } else {
      navigate(`/workspace/${workspaceId}/channel/${id}`);
      setOpenMobile(false);
      subscribeUser();
    }
  };

  const handleManageChannel = (id: string) => {
    navigate(`/workspace/${workspaceId}/channel/${id}/settings`);
  };

  const handleDocumentSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      navigate(`/workspace/${workspaceId}/document`);
    } else {
      navigate(`/workspace/${workspaceId}/document/${id}`);
    }
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
            <>
              <ChannelSelectorList
                channelId={channelId}
                workspaceId={workspaceId}
                onChannelSelect={handleChannelSelect}
                onManageChannel={handleManageChannel}
              />
              <DocumentSelectorList
                workspaceId={workspaceId}
                documentId={documentId}
                onDocumentSelect={handleDocumentSelect}
              />
            </>
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
