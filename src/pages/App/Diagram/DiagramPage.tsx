import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { useDiagramCollaboration } from "@/hooks/use-diagram-collaboration";
import { useDiagramCursorAwareness } from "@/hooks/use-diagram-cursor-awareness";
import { ActiveUsers } from "../Document/ActiveUsers";
import { ConnectionStatus } from "../Document/ConnectionStatus";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";
import { getCameraFromAppState } from "@/lib/canvas-coordinates";

function DiagramPageContent({ diagramId }: { diagramId: Id<"diagrams"> }) {
  const viewer = useQuery(api.users.viewer);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";

  // Set up Yjs collaboration
  const {
    yElements,
    yAssets,
    awareness,
    provider,
    isConnected,
    isLoading,
  } = useDiagramCollaboration({
    diagramId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
  });

  // Get remote pointers for jump-to-user and avatar stack
  const { remotePointers } = useDiagramCursorAwareness(awareness);

  // Jump to user's cursor position
  const handleJumpToUser = (user: { clientId: number }) => {
    if (!excalidrawAPI) return;

    const remotePointer = remotePointers.find((p) => p.clientId === user.clientId);
    if (!remotePointer?.pointer) return;

    const appState = excalidrawAPI.getAppState();
    const camera = getCameraFromAppState(appState);
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;

    // Calculate new scroll position to center on pointer
    const newScrollX = viewportCenterX / camera.z - remotePointer.pointer.x;
    const newScrollY = viewportCenterY / camera.z - remotePointer.pointer.y;

    excalidrawAPI.updateScene({
      appState: {
        scrollX: newScrollX,
        scrollY: newScrollY,
      },
    });
  };

  if (!viewer) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* Header with collaboration UI */}
      <div className="absolute top-5 right-10 z-50 flex items-center gap-3">
        <ConnectionStatus isConnected={isConnected} />
        <ActiveUsers
          remoteUsers={remotePointers.map((p) => ({
            ...p,
            cursor: p.pointer ? { anchor: 0, head: 0 } : null, // Map pointer to cursor for ActiveUsers compatibility
          }))}
          currentUser={viewer && awareness ? { name: viewer.name, color: getExcalidrawCollaboratorColor(awareness.clientID, isDarkTheme) } : undefined}
          onUserClick={handleJumpToUser}
        />
      </div>

      {/* Editor */}
      {!isLoading && (
        <ExcalidrawEditor
          yElements={yElements}
          yAssets={yAssets}
          awareness={awareness}
          provider={provider}
          onExcalidrawAPI={setExcalidrawAPI}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center h-full">
          <div className="text-muted-foreground animate-pulse">Loading diagram...</div>
        </div>
      )}
    </div>
  );
}

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: Id<"diagrams"> }>();
  if (!diagramId) {
    return null;
  }
  return <DiagramPageContent diagramId={diagramId} />;
}
