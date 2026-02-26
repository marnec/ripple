import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

export function Diagrams() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDiagram = useMutation(api.diagrams.create);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDiagram({ workspaceId: workspaceId as Id<"workspaces"> });
    void navigate(`/workspaces/${workspaceId}/diagrams/${id}`);
  };

  return (
    <ResourceListPage
      resourceType="diagram"
      title="Diagrams"
      workspaceId={workspaceId}
      onCreate={() => void handleCreate()}
      createLabel="New diagram"
    />
  );
}
