import { WorkspaceSelector } from "./WorkspaceSelector";
import { Id } from "../../convex/_generated/dataModel";
import { ChannelSelector } from "./ChannelSelector";
import { useNavigate } from "react-router-dom";

export function Sidebar({ 
  currentWorkspace,
  onWorkspaceSelect,
}: { 
  currentWorkspace?: string,
  onWorkspaceSelect: (id: string) => void
}) {
  const navigate = useNavigate();

  const handleChannelSelect = (id: string) => {
    navigate(`channel/${id}`);
  };

  return (
    <div className="flex flex-col w-64 border-r h-full">
      <WorkspaceSelector
        currentWorkspace={currentWorkspace}
        onWorkspaceSelect={onWorkspaceSelect}
      />
      {currentWorkspace && (
        <ChannelSelector
          workspaceId={currentWorkspace as Id<"workspaces">}
          onChannelSelect={handleChannelSelect}
        />
      )}
    </div>
  );
} 