import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import usePushNotifications from "@/hooks/use-push-notifications";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebarSections } from "@/hooks/use-sidebar-sections";
import type { QueryParams } from "@shared/types/routes";
import { useWorkspaceSidebar } from "@/contexts/WorkspaceSidebarContext";
import { useQuery } from "convex-helpers/react/cache";
import { LayoutGroup, m } from "framer-motion";
import { CheckSquare } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DiagramSelectorList } from "./Diagram/DiagramSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { ProjectSelectorList } from "./Project/ProjectSelectorList";
import { SpreadsheetSelectorList } from "./Spreadsheet/SpreadsheetSelectorList";
import { NavUser } from "@/pages/App/UserMenu";
import { RecentsSidebarSection } from "./Recents/RecentsSidebarSection";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { workspaceId, channelId, documentId, diagramId, spreadsheetId, projectId } = useParams<QueryParams>();

  const { subscribeUser } = usePushNotifications();
  const [settings] = useUserSettings();
  const { isOpen, toggle } = useSidebarSections();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");
  const sidebarData = useWorkspaceSidebar();

  const handleChannelSelect = (id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/channels`);
    } else {
      void navigate(`/workspaces/${workspaceId}/channels/${id}`);
      if (settings.notificationsEnabled) void subscribeUser();
    }
  };

  const handleDocumentSelect = (id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/documents`);
    } else {
      void navigate(`/workspaces/${workspaceId}/documents/${id}`);
    }
  };

  const handleDiagramSelect = (id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/diagrams`);
    } else {
      void navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
    }
  };

  const handleSpreadsheetSelect = (id: string | null) => {
    if (isMobile) setOpen(false);
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
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/projects`);
    } else {
      void navigate(`/workspaces/${workspaceId}/projects/${id}/tasks`);
    }
  };

  const handleMyTasksClick = () => {
    if (!workspaceId) return;
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/my-tasks`);
  };

  const isMyTasksActive = location.pathname.includes("/my-tasks");

  const toggleChannels = () => toggle("channels");
  const toggleRecents = () => toggle("recents");

  return (
    <Sidebar collapsible="offcanvas">
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
        {workspaceId && (
          <LayoutGroup>
            {/* Channels */}
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="pb-0">
                <SidebarMenu>
                  <ChannelSelectorList
                    channelId={channelId}
                    workspaceId={workspaceId}
                    channels={sidebarData?.channels}
                    onChannelSelect={handleChannelSelect}
                    isOpen={isOpen("channels")}
                    onToggle={toggleChannels}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>

            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </m.div>

            {/* My Tasks + Projects */}
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
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
                  <ProjectSelectorList
                    workspaceId={workspaceId}
                    projectId={projectId}
                    projects={sidebarData?.projects}
                    onProjectSelect={handleProjectSelect}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>

            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </m.div>

            {/* Documents, Diagrams, Spreadsheets */}
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <DocumentSelectorList
                    workspaceId={workspaceId}
                    documentId={documentId}
                    documents={sidebarData?.documents}
                    onDocumentSelect={handleDocumentSelect}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <DiagramSelectorList
                    workspaceId={workspaceId}
                    diagramId={diagramId}
                    diagrams={sidebarData?.diagrams}
                    onDiagramSelect={handleDiagramSelect}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <SpreadsheetSelectorList
                    workspaceId={workspaceId}
                    spreadsheetId={spreadsheetId}
                    spreadsheets={sidebarData?.spreadsheets}
                    onSpreadsheetSelect={handleSpreadsheetSelect}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>

            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </m.div>

            {/* Recents */}
            <m.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <RecentsSidebarSection
                    workspaceId={workspaceId}
                    isOpen={isOpen("recents")}
                    onToggle={toggleRecents}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </m.div>
          </LayoutGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
