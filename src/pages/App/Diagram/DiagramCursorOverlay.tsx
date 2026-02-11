import { canvasToScreen, getCameraFromAppState } from "@/lib/canvas-coordinates";
import type { RemotePointer } from "@/hooks/use-diagram-cursor-awareness";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface DiagramCursorOverlayProps {
  cursors: RemotePointer[];
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function DiagramCursorOverlay({ cursors, excalidrawAPI }: DiagramCursorOverlayProps) {
  if (!excalidrawAPI) return null;

  // Read camera state just-in-time for transformation
  const appState = excalidrawAPI.getAppState();
  const camera = getCameraFromAppState(appState);

  // Get viewport bounds to filter off-screen cursors
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {cursors.map((cursor) => {
        if (!cursor.pointer) return null;

        // Transform canvas coords to screen coords
        const screenPos = canvasToScreen(cursor.pointer, camera);

        // Skip if off-screen (per user decision: no off-screen indicators)
        if (
          screenPos.x < 0 ||
          screenPos.y < 0 ||
          screenPos.x > viewportWidth ||
          screenPos.y > viewportHeight
        ) {
          return null;
        }

        return (
          <div
            key={cursor.clientId}
            className="absolute transition-opacity duration-200"
            style={{
              left: screenPos.x,
              top: screenPos.y,
              opacity: cursor.isIdle ? 0.3 : 1,
            }}
          >
            {/* Figma-style arrow cursor */}
            <svg
              width="24"
              height="36"
              viewBox="0 0 24 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M0 0L0 24L9 15L15 27L18 25L12 13L24 10L0 0Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>

            {/* Name label - positioned below-right of arrow */}
            <div
              className="absolute top-8 left-6 px-2 py-1 rounded shadow text-xs font-medium whitespace-nowrap"
              style={{
                backgroundColor: cursor.color,
                color: "#fff",
              }}
            >
              {cursor.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
