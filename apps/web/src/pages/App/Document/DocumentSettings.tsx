import { DeleteWarningDialog } from "@/components/DeleteWarningDialog";
import { RippleSpinner } from "@/components/RippleSpinner";
import {
  SettingsLayout,
  useSettingsSection,
  type SettingsSection,
} from "@/components/SettingsLayout";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileHeaderTitle } from "@/contexts/HeaderSlotContext";
import { ResourceDeleted } from "@/pages/ResourceDeleted";
import SomethingWentWrong from "@/pages/SomethingWentWrong";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";;
import { useViewer } from "../UserContext";
import { SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const SECTIONS: SettingsSection[] = [
  {
    value: "general",
    label: "General",
    icon: SlidersHorizontal,
    description: "Document name and tags.",
  },
  {
    value: "danger",
    label: "Delete",
    icon: Trash2,
    title: "Delete document",
    destructive: true,
  },
];

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
  const { active, setActive } = useSettingsSection(SECTIONS);

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
    <>
      <MobileHeaderTitle name={document.name} />
      <SettingsLayout
        eyebrow="Document"
        sections={SECTIONS}
        active={active}
        onChange={setActive}
      >
        {active.value === "general" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="document-name">Document Name</Label>
              <Input
                id="document-name"
                value={displayName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="Enter document name"
              />
              {hasChanges && (
                <Button onClick={() => void handleSaveDetails()}>Save Changes</Button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <TagInput
                value={document.tags ?? []}
                onChange={(tags) => void updateTags({ id: documentId, tags })}
                workspaceId={workspaceId}
                placeholder="Add tags to organize this document..."
              />
            </div>
          </div>
        )}

        {active.value === "danger" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the document and all its content. This
              cannot be undone.
            </p>
            <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Document
            </Button>
            <DeleteWarningDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              onConfirm={() => void handleDeleteDocument()}
              resourceId={documentId}
              workspaceId={workspaceId}
              resourceType="document"
              resourceName={document.name}
            />
          </div>
        )}
      </SettingsLayout>
    </>
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
