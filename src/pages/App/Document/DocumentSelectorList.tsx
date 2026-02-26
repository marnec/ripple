import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
import { DocumentSelectorItem } from "./DocumentSelectorItem";
import { RenameDocumentDialog } from "./RenameDocumentDialog";

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
  const navigate = useNavigate();

  const documents = useQuery(api.documents.list, { workspaceId });
  const favoriteIds = useQuery(api.favorites.listIdsForType, { workspaceId, resourceType: "document" });
  const deleteDocument = useMutation(api.documents.remove);

  const favoriteSet = useMemo(() => new Set(favoriteIds ?? []), [favoriteIds]);
  const favoriteDocs = useMemo(
    () => documents?.filter((d) => favoriteSet.has(d._id)),
    [documents, favoriteSet],
  );

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
      <SidebarGroupLabel asChild>
        <Link to={`/workspaces/${workspaceId}/documents`}>Documents</Link>
      </SidebarGroupLabel>
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
