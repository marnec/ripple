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
import { api } from "../../../convex/_generated/api";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { DiagramSelectorList } from "./Diagram/DiagramSelectorList";
import { NavUser } from "@/pages/App/UserMenu";

export const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setOpenMobile, onSidebarClose } = useSidebar();

  const { workspaceId, channelId, documentId, diagramId } = useParams<QueryParams>();

  const { subscribeUser } = usePushNotifications();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string | null) => {
    if (!id) {
      navigate(`/workspaces/${workspaceId}`);
    } else {
              navigate(`/workspaces/${workspaceId}/channels/${id}`);
      setOpenMobile(false);
      subscribeUser();
    }
  };

  const handleManageChannel = (id: string) => {
    navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const handleDocumentSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      navigate(`/workspaces/${workspaceId}/documents`);
    } else {
                              navigate(`/workspaces/${workspaceId}/documents/${id}`);
    }
  };

  const handleDiagramSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      navigate(`/workspaces/${workspaceId}/diagrams`);
    } else {
      navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
    }
  };

  const handleWorkspaceSelect = (id: string) => {
    navigate(`/workspaces/${id}`);
  };

  const handleChannelDetails = (id: string) => {
    if (!workspaceId) return;
    if (isMobile) onSidebarClose?.();
    navigate(`/workspaces/${workspaceId}/channels/${id}/details`);
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
                onChannelDetails={handleChannelDetails}
              />
              <DocumentSelectorList
                workspaceId={workspaceId}
                documentId={documentId}
                onDocumentSelect={handleDocumentSelect}
              />
              <DiagramSelectorList
                workspaceId={workspaceId}
                diagramId={diagramId}
                onDiagramSelect={handleDiagramSelect}
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
