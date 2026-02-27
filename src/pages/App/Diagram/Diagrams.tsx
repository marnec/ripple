import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

const createDiagramRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"diagrams">
>("diagrams:create");

export function Diagrams() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDiagram = useMutation(createDiagramRef);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDiagram({ workspaceId });
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
