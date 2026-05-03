import { Button } from "@/components/ui/button";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Upload } from "lucide-react";
import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";
import { setPendingImportFile } from "./diagram-import-state";

const createDiagramRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"diagrams">
>("diagrams:create");

export function Diagrams() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDiagram = useMutation(createDiagramRef);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDiagram({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPendingImportFile(file);
    void navigate(`/workspaces/${workspaceId}/diagrams/import`);
  };

  // Preload the parser so the excalidraw chunk overlaps with the file-picker
  // dialog instead of blocking after file selection.
  const prefetchParser = () => {
    void import("@excalidraw/excalidraw");
  };

  return (
    <>
      <ResourceListPage
        resourceType="diagram"
        title="Diagrams"
        workspaceId={workspaceId}
        onCreate={() => void handleCreate()}
        createLabel="New diagram"
        secondaryAction={
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={prefetchParser}
            onFocus={prefetchParser}
          >
            <Upload className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw"
        className="hidden"
        onChange={handleFileSelected}
      />
    </>
  );
}
