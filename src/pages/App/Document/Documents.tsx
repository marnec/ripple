import { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { ResourceListPage } from "../Resources/ResourceListPage";

export function Documents() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDocument = useMutation(api.documents.create);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  const handleCreate = async () => {
    const id = await createDocument({ workspaceId: workspaceId as Id<"workspaces"> });
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
