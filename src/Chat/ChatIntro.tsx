import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function ChatIntro({ 
  workspaceId,
  channelId 
}: { 
  workspaceId?: string,
  channelId?: string
}) {
  const workspace = useQuery(
    api.workspaces.get, 
    workspaceId ? { id: workspaceId as Id<"workspaces"> } : "skip"
  );

  const channel = useQuery(
    api.channels.get,
    channelId ? { id: channelId as Id<"channels"> } : "skip"
  );

  return (
    <div className="flex items-start justify-between border-b py-4">
      <div className="container flex flex-col gap-2">
        <h1 className="text-lg font-semibold md:text-2xl">
          {workspace ? (
            channelId && channel ? (
              <>{channel.name}@{workspace.name}</>
            ) : (
              workspace.name
            )
          ) : (
            'Select a Workspace'
          )}
        </h1>
        <p className="hidden sm:block text-sm text-muted-foreground">
          {workspace
            ? workspace.description
            : 'Select or create a workspace to start chatting'}
        </p>
      </div>
    </div>
  );
}
