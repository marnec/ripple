import { useMutation, useQuery } from "convex/react";
import { FilePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
import { DocumentSelectorItem } from "./DocumentSelectorItem";
import { RenameDocumentDialog } from "./RenameDocumentDialog";
import { SidebarSearchInput } from "../Sidebar/SidebarSearchInput";

export type DocumentSelectorProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents"> | undefined;
  onDocumentSelect: (id: string | null) => void;
};

export function DocumentSelectorList({
  workspaceId,
  documentId,
  onDocumentSelect,
}: DocumentSelectorProps) {
  const [selectedDocForRename, setSelectedDocForRename] = useState<Id<"documents"> | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();

  const documents = useQuery(api.documents.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "document" });
  const createNewDocument = useMutation(api.documents.create);
  const deleteDocument = useMutation(api.documents.remove);

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteDocs = useMemo(
    () => documents?.filter((d) => favoriteSet.has(d._id)),
    [documents, favoriteSet],
  );

  const handleDocumentCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewDocument({ workspaceId });

    onDocumentSelect(id);
  };

  const handleDocumentDelete = async (id: Id<"documents">) => {
    const shouldNavigate = window.location.pathname.includes(id);
    await deleteDocument({ id });
    if (shouldNavigate) {
      onDocumentSelect(null);
    }
  };

  const navigateToDocumentSettings = (id: Id<"documents">) => {
    void navigate(`/workspaces/${workspaceId}/documents/${id}/settings`);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Documents</SidebarGroupLabel>
      <div className="absolute right-3 top-3.5 flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
        <button onClick={() => setShowSearch((s) => !s)} title="Search documents" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <Search />
        </button>
        <button onClick={() => {void handleDocumentCreate()}} title="Create document" className="flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:size-4">
          <FilePlus />
        </button>
      </div>
      {showSearch && (
        <SidebarSearchInput
          workspaceId={workspaceId}
          resourceRoute="documents"
          onClose={() => setShowSearch(false)}
        />
      )}
      <SidebarMenu>
        {favoriteDocs?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No starred documents</p>
        )}
        {favoriteDocs?.map((document) => (
          <DocumentSelectorItem
            key={document._id}
            document={document}
            documentId={documentId}
            onDocumentSelect={onDocumentSelect}
            onRenameDocument={setSelectedDocForRename}
            onManageDocument={navigateToDocumentSettings}
            onDeleteDocument={(id) => void handleDocumentDelete(id)}
          />
        ))}
      </SidebarMenu>
      {!!selectedDocForRename && (
        <RenameDocumentDialog
          documentId={selectedDocForRename}
          open={!!selectedDocForRename}
          onOpenChange={(e) => !e && setSelectedDocForRename(null)}
        />
      )}
    </SidebarGroup>
  );
}
