import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import type { Awareness } from "y-protocols/awareness";
import { useDiagramCursorAwareness } from "@/hooks/use-diagram-cursor-awareness";
import { getCameraFromAppState } from "@/lib/canvas-coordinates";
import { getExcalidrawCollaboratorColor } from "@/lib/user-colors";
import { ActiveUsers } from "../Document/ActiveUsers";

/**
 * The diagram's presence avatars, and the jump-to-cursor they carry.
 *
 * A component rather than something the surface renders directly: presence is
 * derived from pointers here (not text cursors), and jumping needs the canvas
 * API, which only exists once the canvas has mounted. The rule about *when*
 * presence is shown at all stays with `CollaborativeSurface`.
 */
export function DiagramActiveUsers({
  awareness,
  excalidrawAPI,
  viewer,
}: {
  awareness: Awareness;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  viewer: { name?: string } | null | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const { remotePointers } = useDiagramCursorAwareness(awareness);

  const handleJumpToUser = (user: { clientId: number }) => {
    if (!excalidrawAPI) return;

    const remotePointer = remotePointers.find((p) => p.clientId === user.clientId);
    if (!remotePointer?.pointer) return;

    const appState = excalidrawAPI.getAppState();
    const camera = getCameraFromAppState(appState);
    const viewportCenterX = window.innerWidth / 2;
    const viewportCenterY = window.innerHeight / 2;

    excalidrawAPI.updateScene({
      appState: {
        scrollX: viewportCenterX / camera.z - remotePointer.pointer.x,
        scrollY: viewportCenterY / camera.z - remotePointer.pointer.y,
      },
    });
  };

  return (
    <ActiveUsers
      remoteUsers={remotePointers.map((p) => ({
        ...p,
        cursor: p.pointer ? { anchor: 0, head: 0 } : null,
      }))}
      currentUser={
        viewer
          ? {
              name: viewer.name,
              color: getExcalidrawCollaboratorColor(awareness.clientID, isDarkTheme),
            }
          : undefined
      }
      onUserClick={handleJumpToUser}
    />
  );
}
