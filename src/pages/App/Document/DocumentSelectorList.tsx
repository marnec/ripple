import { useMutation, useQuery } from "convex/react";
import { FilePlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../../../components/ui/sidebar";
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
  const createNewDocument = useMutation(api.documents.create);
  const deleteDocument = useMutation(api.documents.remove);

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
      <SidebarGroupAction onClick={() => {void handleDocumentCreate()}} title="Create document">
        <FilePlus />
        <span className="sr-only">Create channel</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {documents?.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No documents yet</p>
        )}
        {documents?.map((document) => (
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
