import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { QueryParams } from "@/types";
import { useQueries, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { ChannelSelectorList } from "./Channel/ChannelSelectorList";
import { DocumentSelectorList } from "./Document/DocumentSelectorList";
import { NavUser } from "./UserMenu";
import { WorkspaceSwitcher } from "./Workspace/WorkspaceSwitcher";
import { makeUseQueryWithStatus } from "convex-helpers/react";

export const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

export function AppSidebar() {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar()
  
  const { workspaceId, channelId, documentId } = useParams<QueryParams>();

  const workspaces = useQuery(api.workspaces.list);
  const activeWorkspace = useQuery(api.workspaces.get, workspaceId ? { id: workspaceId } : "skip");

  const handleChannelSelect = (id: string) => {
    setOpenMobile(false);

    navigate(`channel/${id}`);
  };

  const handleDocumentSelect = (id: string | null) => {
    setOpenMobile(false);
    
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
