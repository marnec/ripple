import { WorkspaceSelector } from "./WorkspaceSelector";

import { Id } from "../../convex/_generated/dataModel";
import { ChannelSelector } from "./ChannelSelector";

export function Sidebar({ 
  currentWorkspace,
  currentChannel,
  onWorkspaceSelect,
  onChannelSelect 
}: { 
  currentWorkspace?: string,
  currentChannel?: string,
  onWorkspaceSelect: (id: string) => void,
  onChannelSelect: (id: string) => void
}) {
  return (
    <div className="flex flex-col w-64 border-r h-full">
      <WorkspaceSelector
        currentWorkspace={currentWorkspace}
        onWorkspaceSelect={onWorkspaceSelect}
      />
      {currentWorkspace && (
        <ChannelSelector
          workspaceId={currentWorkspace as Id<"workspaces">}
          currentChannel={currentChannel}
          onChannelSelect={onChannelSelect}
        />
      )}
    </div>
  );
} 