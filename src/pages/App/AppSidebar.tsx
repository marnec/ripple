import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import usePushNotifications from "@/hooks/use-push-notifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { CheckSquare } from "lucide-react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DiagramSelectorList } from "./Diagram/DiagramSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { ProjectSelectorList } from "./Project/ProjectSelectorList";
import { SpreadsheetSelectorList } from "./Spreadsheet/SpreadsheetSelectorList";
import { NavUser } from "@/pages/App/UserMenu";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setOpenMobile } = useSidebar();
  const isMobile = useIsMobile();
  const { workspaceId, channelId, documentId, diagramId, spreadsheetId, projectId } = useParams<QueryParams>();

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

  const handleSpreadsheetSelect = (id: string | null) => {
    setOpenMobile(false);

    if (!id) {
      void navigate(`/workspaces/${workspaceId}/spreadsheets`);
    } else {
      void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}`);
    }
  };

  const handleWorkspaceSelect = (id: string) => {
    void navigate(`/workspaces/${id}`);
  };

  const handleProjectSelect = (id: string | null) => {
    setOpenMobile(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/projects`);
    } else {
      void navigate(`/workspaces/${workspaceId}/projects/${id}`);
    }
  };

  const handleMyTasksClick = () => {
    if (!workspaceId) return;
    if (isMobile) setOpenMobile(false);
    void navigate(`/workspaces/${workspaceId}/my-tasks`);
  };

  const isMyTasksActive = location.pathname.includes("/my-tasks");

  return (
    <Sidebar collapsible="icon">
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
            <SidebarMenu>
              {/* My Tasks - Personal productivity shortcut above all sections */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleMyTasksClick}
                  isActive={isMyTasksActive}
                  tooltip="My Tasks"
                >
                  <CheckSquare />
                  <span>My Tasks</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <ChannelSelectorList
                channelId={channelId}
                workspaceId={workspaceId}
                onChannelSelect={handleChannelSelect}
              />
              <ProjectSelectorList
                workspaceId={workspaceId}
                projectId={projectId}
                onProjectSelect={handleProjectSelect}
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
              <SpreadsheetSelectorList
                workspaceId={workspaceId}
                spreadsheetId={spreadsheetId}
                onSpreadsheetSelect={handleSpreadsheetSelect}
              />
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
