import { canvasToScreen, getCameraFromAppState } from "@/lib/canvas-coordinates";
import type { RemotePointer } from "@/hooks/use-diagram-cursor-awareness";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Lock } from "lucide-react";

interface DiagramLockOverlayProps {
  cursors: RemotePointer[];
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function DiagramLockOverlay({ cursors, excalidrawAPI }: DiagramLockOverlayProps) {
  if (!excalidrawAPI) return null;

  // Collect all locked element IDs with their owner
  const lockedElementsMap = new Map<string, RemotePointer>();
  cursors.forEach((cursor) => {
    cursor.lockedElements.forEach((elementId) => {
      // First user to lock an element wins (in case of race)
      if (!lockedElementsMap.has(elementId)) {
        lockedElementsMap.set(elementId, cursor);
      }
    });
  });

  if (lockedElementsMap.size === 0) return null;

  // Read camera state for transformation
  const appState = excalidrawAPI.getAppState();
  const camera = getCameraFromAppState(appState);
  const elements = excalidrawAPI.getSceneElements();

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {Array.from(lockedElementsMap.entries()).map(([elementId, cursor]) => {
        const element = elements.find((el) => el.id === elementId);
        if (!element) return null;

        // Transform element position to screen coords
        const screenPos = canvasToScreen({ x: element.x, y: element.y }, camera);

        return (
          <div
            key={elementId}
            className="absolute text-xs font-medium shadow-md rounded px-2 py-1 flex items-center gap-1"
            style={{
              left: screenPos.x,
              top: screenPos.y - 28, // Position above element
              backgroundColor: cursor.color,
              color: "#fff",
            }}
          >
            <Lock className="h-3 w-3" />
            <span>{cursor.name}</span>
          </div>
        );
      })}
    </div>
  );
}
