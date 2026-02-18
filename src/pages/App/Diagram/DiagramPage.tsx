import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { useDiagramCollaboration } from "@/hooks/use-diagram-collaboration";
import { useDiagramCursorAwareness } from "@/hooks/use-diagram-cursor-awareness";
import { ActiveUsers } from "../Document/ActiveUsers";
import { ConnectionStatus } from "../Document/ConnectionStatus";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";
import { getCameraFromAppState } from "@/lib/canvas-coordinates";
import { Excalidraw } from "@excalidraw/excalidraw";
import { Theme } from "@excalidraw/excalidraw/element/types";
import { yjsToExcalidraw } from "y-excalidraw";
import * as Y from "yjs";

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
    isOffline,
    isLoading,
  } = useDiagramCollaboration({
    diagramId,
    userName: viewer?.name ?? "Anonymous",
    userId: viewer?._id ?? "anonymous",
  });

  // Get remote pointers for jump-to-user and avatar stack
  const { remotePointers } = useDiagramCursorAwareness(awareness);

  // Cold-start snapshot fallback: offline + loading (no IndexedDB data)
  const isColdStart = isOffline && isLoading;
  const snapshotUrl = useQuery(
    api.snapshots.getSnapshotUrl,
    isColdStart ? { resourceType: "diagram", resourceId: diagramId } : "skip"
  );

  const [snapshotElements, setSnapshotElements] = useState<any[] | null>(null);

  // Fetch and convert snapshot when URL is available
  useEffect(() => {
    if (!snapshotUrl || !isColdStart) {
      return;
    }

    const loadSnapshot = async () => {
      try {
        const response = await fetch(snapshotUrl);
        const arrayBuffer = await response.arrayBuffer();
        const tempDoc = new Y.Doc();
        Y.applyUpdateV2(tempDoc, new Uint8Array(arrayBuffer));
        const yElementsArray = tempDoc.getArray<Y.Map<any>>("elements");
        const elements = yjsToExcalidraw(yElementsArray);
        setSnapshotElements(elements);
      } catch (error) {
        console.error("Failed to load diagram snapshot:", error);
      }
    };

    void loadSnapshot();

    // Cleanup when conditions change
    return () => {
      setSnapshotElements(null);
    };
  }, [snapshotUrl, isColdStart]);

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
    return <div className="h-full w-full" />;
  }

  // Show snapshot fallback in cold-start offline mode
  if (isColdStart && snapshotElements) {
    return (
      <div className="relative h-full w-full">
        <div className="absolute top-5 right-10 z-50 flex items-center gap-3">
          <ConnectionStatus isConnected={false} />
        </div>
        <div className="absolute top-5 left-10 z-50 text-sm text-muted-foreground">
          Viewing saved version (offline)
        </div>
        <Excalidraw
          initialData={{ elements: snapshotElements }}
          viewModeEnabled={true}
          theme={resolvedTheme as Theme}
          zenModeEnabled={true}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden animate-fade-in">
      {/* Header with collaboration UI */}
      <div className="absolute top-5 right-10 z-50 flex items-center gap-3">
        <ConnectionStatus isConnected={isConnected} />
        {isConnected && (
          <ActiveUsers
            remoteUsers={remotePointers.map((p) => ({
              ...p,
              cursor: p.pointer ? { anchor: 0, head: 0 } : null, // Map pointer to cursor for ActiveUsers compatibility
            }))}
            currentUser={viewer && awareness ? { name: viewer.name, color: getExcalidrawCollaboratorColor(awareness.clientID, isDarkTheme) } : undefined}
            onUserClick={handleJumpToUser}
          />
        )}
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

      {isLoading && <div className="h-full w-full" />}
    </div>
  );
}

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: Id<"diagrams"> }>();
  if (!diagramId) {
    return null;
  }
  return <DiagramPageContent diagramId={diagramId} key={diagramId} />;
}
