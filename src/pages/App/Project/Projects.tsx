import { QueryParams } from "@shared/types/routes";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "../Resources/ResourceListPage";
import { CreateProjectDialog } from "./CreateProjectDialog";

export function Projects() {
  const { workspaceId } = useParams<QueryParams>();
  const [showCreate, setShowCreate] = useState(false);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  return (
    <ResourceListPage
      resourceType="project"
      title="Projects"
      workspaceId={workspaceId}
      onCreate={() => setShowCreate(true)}
      createLabel="New project"
      createDialog={
        <CreateProjectDialog
          workspaceId={workspaceId}
          open={showCreate}
          onOpenChange={setShowCreate}
        />
      }
    />
  );
}
