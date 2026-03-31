import { Button } from "@/components/ui/button";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Upload } from "lucide-react";
import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";
import { setPendingImportFile } from "./import-state";

const createDocumentRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"documents">
>("documents:create");

export function Documents() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDocument = useMutation(createDocumentRef);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDocument({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/documents/${id}`);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";
    setPendingImportFile(file);
    void navigate(`/workspaces/${workspaceId}/documents/import`);
  };

  return (
    <>
      <ResourceListPage
        resourceType="document"
        title="Documents"
        workspaceId={workspaceId}
        onCreate={() => void handleCreate()}
        createLabel="New document"
        secondaryAction={
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx"
        className="hidden"
        onChange={handleFileSelected}
      />
    </>
  );
}
