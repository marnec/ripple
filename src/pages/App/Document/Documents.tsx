import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useNavigate, useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

const createDocumentRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces"> },
  Id<"documents">
>("documents:create");

export function Documents() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDocument = useMutation(createDocumentRef);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDocument({ workspaceId });
    void navigate(`/workspaces/${workspaceId}/documents/${id}`);
  };

  return (
    <ResourceListPage
      resourceType="document"
      title="Documents"
      workspaceId={workspaceId}
      onCreate={() => void handleCreate()}
      createLabel="New document"
    />
  );
}
