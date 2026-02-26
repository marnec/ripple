import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "../Resources/ResourceListPage";

export function Diagrams() {
  const { workspaceId } = useParams<QueryParams>();

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  return (
    <ResourceListPage
      resourceType="diagram"
      title="Diagrams"
      workspaceId={workspaceId}
    />
  );
}
