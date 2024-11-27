import { WorkspaceSelector } from "./Workspace/WorkspaceSelector";
import { Id } from "../../convex/_generated/dataModel";
import { ChannelSelector } from "./Channel/ChannelSelector";
import { useNavigate, useParams } from "react-router-dom";

export function Sidebar() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  const handleChannelSelect = (id: string) => {
    navigate(`channel/${id}`);
  };

  const handleWorkspaceSelect = (id: string) => {
    navigate(`/workspaces/${id}`);
  };

  return (
    <div className="flex flex-col w-64 border-r h-full">
      <WorkspaceSelector
        onWorkspaceSelect={handleWorkspaceSelect}
      />
      {workspaceId && (
        <ChannelSelector
          workspaceId={workspaceId as Id<"workspaces">}
          onChannelSelect={handleChannelSelect}
        />
      )}
    </div>
  );
}
