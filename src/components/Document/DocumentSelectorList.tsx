import { useMutation, useQuery } from "convex/react";
import { FilePlus } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel, SidebarMenu } from "../ui/sidebar";
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

  const documents = useQuery(api.documents.list, { workspaceId });
  const createNewDocument = useMutation(api.documents.create);
  const deleteDocument = useMutation(api.documents.remove);

  const handleDocumentDelete = async (id: Id<"documents">) => {
    await deleteDocument({ id });

    onDocumentSelect(null);
  };

  const handleDocumentCreate = async () => {
    if (!workspaceId) return;

    const id = await createNewDocument({ workspaceId });

    onDocumentSelect(id);
  };

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Documents</SidebarGroupLabel>
      <SidebarGroupAction onClick={handleDocumentCreate} title="Create document">
        <FilePlus />
        <span className="sr-only">Create channel</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {documents?.map((document) => (
          <DocumentSelectorItem
            key={document._id}
            document={document}
            documentId={documentId}
            onDocumentSelect={onDocumentSelect}
            onRenameDocument={setSelectedDocForRename}
            onDeleteDocument={handleDocumentDelete}
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
