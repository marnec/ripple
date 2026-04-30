import { DeleteWarningDialog } from "@/components/DeleteWarningDialog";
import { RippleSpinner } from "@/components/RippleSpinner";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useViewer } from "../UserContext";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type DocumentSettingsContentProps = {
  workspaceId: Id<"workspaces">;
  documentId: Id<"documents">;
};

function DocumentSettingsContent({
  workspaceId,
  documentId,
}: DocumentSettingsContentProps) {
  const navigate = useNavigate();
  // Queries
  const document = useQuery(api.documents.get, { id: documentId });
  const currentUser = useViewer();

  // Mutations
  const renameDocument = useMutation(api.documents.rename);
  const deleteDocument = useMutation(api.documents.remove);
  const updateTags = useMutation(api.documents.updateTags);

  // Local state
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (document === undefined || currentUser === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <RippleSpinner />
      </div>
    );
  }

  if (currentUser === null) {
    return <SomethingWentWrong />;
  }

  if (document === null) {
    return <ResourceDeleted resourceType="document" />;
  }

  const displayName = documentName ?? document.name;
  const hasChanges = documentName !== null;

  const handleSaveDetails = async () => {
    try {
      await renameDocument({ id: documentId, name: displayName });
      toast.success("Document updated");
      setDocumentName(null);
    } catch (error) {
      toast.error("Error updating document", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleDeleteDocument = async () => {
    try {
      await deleteDocument({ id: documentId });
      toast.success("Document deleted");
      void navigate(`/workspaces/${workspaceId}/documents`);
    } catch (error) {
      toast.error("Error deleting document", {
        description: error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl animate-fade-in">
      <MobileHeaderTitle name={document.name} />
      <h1 className="hidden md:block text-2xl font-bold mb-6">Document Settings</h1>

      {/* Details Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Details</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-name">Document Name</Label>
            <Input
              id="document-name"
              value={displayName}
              onChange={(e) => setDocumentName(e.target.value)}
              placeholder="Enter document name"
            />
          </div>

          {hasChanges && (
            <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
          )}
        </div>
      </section>

      {/* Tags Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Tags</h2>
        <TagInput
          value={document.tags ?? []}
          onChange={(tags) => void updateTags({ id: documentId, tags })}
          workspaceId={workspaceId}
          placeholder="Add tags to organize this document..."
        />
      </section>

      <Separator className="my-6" />

      {/* Danger Zone */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-destructive">
          Danger Zone
        </h2>
        <Button
          variant="destructive"
          onClick={() => setDeleteDialogOpen(true)}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Document
        </Button>
        <p className="text-sm text-muted-foreground mt-2">
          This will permanently delete the document and all its content.
        </p>
        <DeleteWarningDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={() => void handleDeleteDocument()}
          resourceId={documentId}
          workspaceId={workspaceId}
          resourceType="document"
          resourceName={document.name}
        />
      </section>
    </div>
  );
}

/* ─── Entry Point ────────────────────────────────────────────────── */

export const DocumentSettings = () => {
  const { workspaceId, documentId } = useParams<QueryParams>();

  if (!workspaceId || !documentId) return <SomethingWentWrong />;

  return (
    <DocumentSettingsContent
      workspaceId={workspaceId}
      documentId={documentId}
    />
  );
};
