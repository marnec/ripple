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
import { QueryParams } from "@shared/types/routes";
import { useQuery } from "convex/react";
import { LayoutGroup, motion } from "framer-motion";
import { CheckSquare } from "lucide-react";
import { useCallback } from "react";
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

import { AllFavoriteIds } from "./Document/DocumentSelectorList";

export function AppSidebar({ allFavoriteIds }: { allFavoriteIds?: AllFavoriteIds | null }) {
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

  const handleChannelSelect = useCallback((id: string | null) => {
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/channels`);
    } else {
      void navigate(`/workspaces/${workspaceId}/channels/${id}`);
      if (isMobile) setOpen(false);
      if (settings.notificationsEnabled) void subscribeUser();
    }
  }, [navigate, workspaceId, isMobile, setOpen, settings.notificationsEnabled, subscribeUser]);

  const handleDocumentSelect = useCallback((id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/documents`);
    } else {
      void navigate(`/workspaces/${workspaceId}/documents/${id}`);
    }
  }, [navigate, workspaceId, isMobile, setOpen]);

  const handleDiagramSelect = useCallback((id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/diagrams`);
    } else {
      void navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
    }
  }, [navigate, workspaceId, isMobile, setOpen]);

  const handleSpreadsheetSelect = useCallback((id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/spreadsheets`);
    } else {
      void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}`);
    }
  }, [navigate, workspaceId, isMobile, setOpen]);

  const handleWorkspaceSelect = useCallback((id: string) => {
    void navigate(`/workspaces/${id}`);
  }, [navigate]);

  const handleProjectSelect = useCallback((id: string | null) => {
    if (isMobile) setOpen(false);
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/projects`);
    } else {
      void navigate(`/workspaces/${workspaceId}/projects/${id}/tasks`);
    }
  }, [navigate, workspaceId, isMobile, setOpen]);

  const handleMyTasksClick = useCallback(() => {
    if (!workspaceId) return;
    if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/my-tasks`);
  }, [navigate, workspaceId, isMobile, setOpen]);

  const isMyTasksActive = location.pathname.includes("/my-tasks");

  const toggleChannels = useCallback(() => toggle("channels"), [toggle]);
  const toggleProjects = useCallback(() => toggle("projects"), [toggle]);
  const toggleDocuments = useCallback(() => toggle("documents"), [toggle]);
  const toggleDiagrams = useCallback(() => toggle("diagrams"), [toggle]);
  const toggleSpreadsheets = useCallback(() => toggle("spreadsheets"), [toggle]);
  const toggleRecents = useCallback(() => toggle("recents"), [toggle]);

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
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="pb-0">
                <SidebarMenu>
                  <ChannelSelectorList
                    channelId={channelId}
                    workspaceId={workspaceId}
                    onChannelSelect={handleChannelSelect}
                    isOpen={isOpen("channels")}
                    onToggle={toggleChannels}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>

            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </motion.div>

            {/* My Tasks + Projects */}
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={handleMyTasksClick}
                      isActive={isMyTasksActive}
                      tooltip="My Tasks"
                      className="pl-7"
                    >
                      <CheckSquare />
                      <span>My Tasks</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <ProjectSelectorList
                    workspaceId={workspaceId}
                    projectId={projectId}
                    onProjectSelect={handleProjectSelect}
                    allFavoriteIds={allFavoriteIds ?? undefined}
                    isOpen={isOpen("projects")}
                    onToggle={toggleProjects}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>

            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </motion.div>

            {/* Documents, Diagrams, Spreadsheets */}
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <DocumentSelectorList
                    workspaceId={workspaceId}
                    documentId={documentId}
                    onDocumentSelect={handleDocumentSelect}
                    allFavoriteIds={allFavoriteIds ?? undefined}
                    isOpen={isOpen("documents")}
                    onToggle={toggleDocuments}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <DiagramSelectorList
                    workspaceId={workspaceId}
                    diagramId={diagramId}
                    onDiagramSelect={handleDiagramSelect}
                    allFavoriteIds={allFavoriteIds ?? undefined}
                    isOpen={isOpen("diagrams")}
                    onToggle={toggleDiagrams}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <SpreadsheetSelectorList
                    workspaceId={workspaceId}
                    spreadsheetId={spreadsheetId}
                    onSpreadsheetSelect={handleSpreadsheetSelect}
                    allFavoriteIds={allFavoriteIds ?? undefined}
                    isOpen={isOpen("spreadsheets")}
                    onToggle={toggleSpreadsheets}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>

            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarSeparator />
            </motion.div>

            {/* Recents */}
            <motion.div layout="position" transition={{ duration: 0.2, ease: "easeOut" }}>
              <SidebarGroup className="py-0">
                <SidebarMenu>
                  <RecentsSidebarSection
                    workspaceId={workspaceId}
                    isOpen={isOpen("recents")}
                    onToggle={toggleRecents}
                  />
                </SidebarMenu>
              </SidebarGroup>
            </motion.div>
          </LayoutGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
