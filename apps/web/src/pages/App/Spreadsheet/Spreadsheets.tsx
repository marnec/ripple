import { Button } from "@/components/ui/button";
import type { QueryParams } from "@ripple/shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Upload } from "lucide-react";
import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Id } from "@convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";
import { setPendingImportFile } from "./spreadsheet-import-state";

const createSpreadsheetRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"spreadsheets">
>("spreadsheets:create");

export function Spreadsheets() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createSpreadsheet = useMutation(createSpreadsheetRef);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createSpreadsheet({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}`);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPendingImportFile(file);
    void navigate(`/workspaces/${workspaceId}/spreadsheets/import`);
  };

  // Preload the parser so the 250KB chunk overlaps with the file-picker dialog
  // instead of blocking after file selection.
  const prefetchParser = () => {
    void import("tabularjs");
  };

  return (
    <>
      <ResourceListPage
        resourceType="spreadsheet"
        title="Spreadsheets"
        workspaceId={workspaceId}
        onCreate={() => void handleCreate()}
        createLabel="New spreadsheet"
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
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={handleFileSelected}
      />
    </>
  );
}
