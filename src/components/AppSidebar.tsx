import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { QueryParams } from "@/types";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { NavUser } from "./UserMenu";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";

export function AppSidebar({ setSidebarOpen }: { setSidebarOpen: (val: boolean) => void }) {
  const { workspaceId, channelId, documentId } = useParams<QueryParams>();
  const isMobile = useIsMobile();

  const navigate = useNavigate();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string) => {
    if (isMobile) setSidebarOpen(false);

    navigate(`channel/${id}`);
  };

  const handleDocumentSelect = (id: string | null) => {
    if (!id) {
      navigate("document");
    } else {
      navigate(`document/${id}`);
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
