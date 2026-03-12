import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ChevronRight, File, Plus } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  useSidebar,
} from "../../../components/ui/sidebar";
import { DocumentSelectorItem } from "./DocumentSelectorItem";
import { RenameDocumentDialog } from "./RenameDocumentDialog";
import { EmptyFavoriteSlots } from "../Resources/EmptyFavoriteSlots";
import { MAX_SIDEBAR_FAVORITES, preselectSearchTab } from "../Resources/sidebar-constants";

export type AllFavoriteIds = {
  document: string[];
  diagram: string[];
  spreadsheet: string[];
  project: string[];
};

export type DocumentSelectorProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string | null) => void;
  allFavoriteIds: AllFavoriteIds | undefined;
  isOpen: boolean;
  onToggle: () => void;
};

export function DocumentSelectorList({
  workspaceId,
  documentId,
  onDocumentSelect,
  allFavoriteIds,
  isOpen,
  onToggle,
}: DocumentSelectorProps) {
  const [selectedDocForRename, setSelectedDocForRename] = useState<Id<"documents"> | null>(null);
  const navigate = useNavigate();
  const { isMobile, setOpen: setSidebarOpen } = useSidebar();
  const location = useLocation();
  const isListActive = location.pathname.endsWith("/documents");

  const documents = useQuery(api.documents.list, { workspaceId });
  const createDocument = useMutation(api.documents.create);
  const toggleFavorite = useMutation(api.favorites.toggle);

  const favoriteSet = useMemo(() => new Set(allFavoriteIds?.document ?? []), [allFavoriteIds]);
  const favoriteDocs = useMemo(
    () => documents?.filter((d) => favoriteSet.has(d._id)).slice(0, MAX_SIDEBAR_FAVORITES),
    [documents, favoriteSet],
  );

  const handleUnstar = (id: Id<"documents">) => {
    void toggleFavorite({ workspaceId, resourceType: "document", resourceId: id });
  };

  const navigateToDocumentSettings = (id: Id<"documents">) => {
    if (isMobile) setSidebarOpen(false);
    void navigate(`/workspaces/${workspaceId}/documents/${id}/settings`);
  };

  const handleCreate = async () => {
    const id = await createDocument({ workspaceId });
    onDocumentSelect(id);
  };

  const handleHeaderClick = () => {
    preselectSearchTab(workspaceId, "document");
    onDocumentSelect(null);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} render={<SidebarMenuItem />}>
        <SidebarMenuButton tooltip="Documents" onClick={handleHeaderClick} isActive={isListActive}>
          <CollapsibleTrigger render={<span role="button" className="shrink-0" />} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <ChevronRight className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
          </CollapsibleTrigger>
          <File className="size-4" />
          <span className="font-medium">Documents</span>
        </SidebarMenuButton>
        <SidebarMenuAction showOnHover onClick={() => void handleCreate()}>
          <Plus />
          <span className="sr-only">New Document</span>
        </SidebarMenuAction>
        <CollapsibleContent>
          <SidebarMenuSub className="gap-0.5">
            {favoriteDocs?.map((document) => (
              <DocumentSelectorItem
                key={document._id}
                document={document}
                documentId={documentId}
                onDocumentSelect={onDocumentSelect}
                onRenameDocument={setSelectedDocForRename}
                onManageDocument={navigateToDocumentSettings}
                onUnstarDocument={handleUnstar}
              />
            ))}
            <EmptyFavoriteSlots filled={favoriteDocs?.length ?? 0} workspaceId={workspaceId} resourceType="document" />
          </SidebarMenuSub>
        </CollapsibleContent>
        {!!selectedDocForRename && (
          <RenameDocumentDialog
            documentId={selectedDocForRename}
            open={!!selectedDocForRename}
            onOpenChange={(e) => !e && setSelectedDocForRename(null)}
          />
        )}
    </Collapsible>
  );
}
