import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

const createSpreadsheetRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"spreadsheets">
>("spreadsheets:create");

export function Spreadsheets() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createSpreadsheet = useMutation(createSpreadsheetRef);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createSpreadsheet({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/spreadsheets/${id}`);
  };

  return (
    <ResourceListPage
      resourceType="spreadsheet"
      title="Spreadsheets"
      workspaceId={workspaceId}
      onCreate={() => void handleCreate()}
      createLabel="New spreadsheet"
    />
  );
}
