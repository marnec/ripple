import { QueryParams } from "@shared/types/routes";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "../Resources/ResourceListPage";
import { CreateChannelDialog } from "./CreateChannelDialog";

export function ChannelDetails() {
  const { workspaceId } = useParams<QueryParams>();
  const [showCreate, setShowCreate] = useState(false);

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  return (
    <ResourceListPage
      resourceType="channel"
      title="Channels"
      workspaceId={workspaceId}
      onCreate={() => setShowCreate(true)}
      createLabel="New channel"
      showFavorites={false}
      createDialog={
        <CreateChannelDialog
          workspaceId={workspaceId}
          open={showCreate}
          onOpenChange={setShowCreate}
        />
      }
    />
  );
}
