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

  // @ts-expect-error TS2589 deep type instantiation with Convex query
  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string | null) => {
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/channels`);
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
      <SidebarContent className={isMobile ? "" : "h-full overflow-hidden!"}>
        {workspaceId && (
          <div className={isMobile ? "flex min-h-0 flex-1 flex-col" : "flex h-[75%] min-h-0 flex-col group-data-[collapsible=icon]:h-auto"}>
            {/* My Tasks — fixed at top */}
            <SidebarGroup className="flex-none pb-0">
              <SidebarMenu>
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
              </SidebarMenu>
            </SidebarGroup>

            {/* Channels — takes remaining vertical space, overflows internally */}
            <SidebarGroup className="min-h-0 flex-1 overflow-hidden pb-0 group-data-[collapsible=icon]:flex-none">
              <SidebarMenu className="h-full">
                <ChannelSelectorList
                  channelId={channelId}
                  workspaceId={workspaceId}
                  onChannelSelect={handleChannelSelect}
                />
              </SidebarMenu>
            </SidebarGroup>

            {/* Favorites-based groups — fixed height for header + n slots each */}
            <SidebarGroup className="flex-none">
              <SidebarMenu>
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
            </SidebarGroup>
          </div>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
