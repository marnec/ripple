import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import usePushNotifications from "@/hooks/use-push-notifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DiagramSelectorList } from "./Diagram/DiagramSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { ProjectSelectorList } from "./Project/ProjectSelectorList";
import { NavUser } from "@/pages/App/UserMenu";

export function AppSidebar() {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();

  const { workspaceId, channelId, documentId, diagramId, projectId } = useParams<QueryParams>();

  const { subscribeUser } = usePushNotifications();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string | null) => {
    if (!id) {
      void navigate(`/workspaces/${workspaceId}`);
    } else {
      void navigate(`/workspaces/${workspaceId}/channels/${id}`);
      setOpenMobile(false);
      void subscribeUser();
    }
  };

  const handleManageChannel = (id: string) => {
    void navigate(`/workspaces/${workspaceId}/channels/${id}/settings`);
  };

  const handleDocumentSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      void navigate(`/workspaces/${workspaceId}/documents`);
    } else {
      void navigate(`/workspaces/${workspaceId}/documents/${id}`);
    }
  };

  const handleDiagramSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      void navigate(`/workspaces/${workspaceId}/diagrams`);
    } else {
      void navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
    }
  };

  const handleWorkspaceSelect = (id: string) => {
    void navigate(`/workspaces/${id}`);
  };

  const handleChannelDetails = (id: string) => {
    if (!workspaceId) return;
    if (isMobile) setOpenMobile(false);
    void navigate(`/workspaces/${workspaceId}/channels/${id}/details`);
  };

  const handleProjectSelect = (id: string | null) => {
    setOpenMobile(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/projects`);
    } else {
      void navigate(`/workspaces/${workspaceId}/projects/${id}`);
    }
  };

  const handleManageProject = (id: string) => {
    void navigate(`/workspaces/${workspaceId}/projects/${id}/settings`);
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
              <ProjectSelectorList
                workspaceId={workspaceId}
                projectId={projectId}
                onProjectSelect={handleProjectSelect}
                onManageProject={handleManageProject}
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
