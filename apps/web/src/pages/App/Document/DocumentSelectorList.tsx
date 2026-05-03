import { memo } from "react";
import { File, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../../../components/ui/sidebar";
import { preselectSearchTab } from "../Resources/sidebar-constants";

export type DocumentSelectorProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string | null) => void;
  documents?: { _id: string; name: string; tags?: string[]; _creationTime: number }[];
};

export const DocumentSelectorList = memo(function DocumentSelectorList({
  workspaceId,
  onDocumentSelect,
}: DocumentSelectorProps) {
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/documents");

  const createDocument = useMutation(api.documents.create);

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "document");
    onDocumentSelect(null);
  };

  const handleCreate = async () => {
    if (isMobile) setSidebarOpen(false);
    const id = await createDocument({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/documents/${id}`);
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Documents" onClick={handleHeaderClick} isActive={isListActive}>
        <File className="size-4" />
        <span className="font-medium">Documents</span>
      </SidebarMenuButton>
      <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
        <Plus />
        <span className="sr-only">New Document</span>
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
});
