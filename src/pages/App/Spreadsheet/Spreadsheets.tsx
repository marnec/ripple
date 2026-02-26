import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

export function Spreadsheets() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createSpreadsheet = useMutation(api.spreadsheets.create);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createSpreadsheet({ workspaceId: workspaceId as Id<"workspaces"> });
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
