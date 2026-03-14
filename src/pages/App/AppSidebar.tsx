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
import { makeFunctionReference } from "convex/server";
import { LayoutGroup, motion } from "framer-motion";
import { CheckSquare } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../convex/_generated/dataModel";

const workspacesListRef = makeFunctionReference<"query">("workspaces:list");
const workspacesGetRef = makeFunctionReference<"query", { id: Id<"workspaces"> }>("workspaces:get");
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

  const workspaces = useQuery(workspacesListRef);
  const activeWorkspace = useQuery(workspacesGetRef, workspaceId ? { id: workspaceId } : "skip");
  const handleChannelSelect = (id: string | null) => {
    if (!id) {
      void navigate(`/workspaces/${workspaceId}/channels`);
    } else {
      void navigate(`/workspaces/${workspaceId}/channels/${id}`);
      if (isMobile) setOpen(false);
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
    if (isMobile) if (isMobile) setOpen(false);
    void navigate(`/workspaces/${workspaceId}/my-tasks`);
  };

  const isMyTasksActive = location.pathname.includes("/my-tasks");

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
                    onToggle={() => toggle("channels")}
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
                    onToggle={() => toggle("projects")}
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
                    onToggle={() => toggle("documents")}
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
                    onToggle={() => toggle("diagrams")}
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
                    onToggle={() => toggle("spreadsheets")}
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
                    onToggle={() => toggle("recents")}
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
