# Phase 13: Diagram Multiplayer Cursors - Research

**Researched:** 2026-02-11
**Domain:** Real-time cursor awareness and element sync for Excalidraw diagrams with Yjs CRDTs
**Confidence:** HIGH

## Summary

Phase 13 adds real-time multiplayer cursor awareness and element synchronization to Excalidraw diagrams using y-excalidraw binding with the existing PartyKit/Yjs infrastructure (Phase 11). The stack is established: Excalidraw 0.18.0 already installed, y-excalidraw provides Yjs bindings for element sync and awareness, and the existing useYjsProvider hook (Phase 11) handles WebSocket transport. Phase 12 established user color consistency (ColorHash singleton) and ActiveUsers component pattern, both reusable here. The main technical challenges are: (1) implementing custom pointer overlay rendering (Excalidraw doesn't render cursors automatically), (2) transforming screen coordinates to canvas coordinates accounting for pan/zoom, (3) implementing lock-on-select conflict prevention, and (4) jump-to-user viewport panning.

**Primary recommendation:** Use y-excalidraw ExcalidrawBinding for element sync, implement custom pointer overlay with SVG cursors positioned via CSS custom properties and canvas coordinate transformation, reuse Phase 12's ColorHash and ActiveUsers patterns, and implement lock-on-select via Awareness state tracking with visual indicators.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Pointer visualization
- Figma-style colored arrow cursor in the user's assigned color
- Always-visible name label next to the pointer (colored tag with display name)
- Natural stacking when pointers overlap — no auto-offset logic needed
- No off-screen indicators — pointers only visible when in the viewer's current viewport

#### In-progress element sync
- Real-time preview when drawing new shapes — others see the shape forming as it's dragged
- Live movement when moving or resizing elements — others see the element sliding in real-time
- Lock-on-select for conflict prevention — selecting an element locks it for that user, others see a lock indicator
- Freehand drawing sync approach is Claude's discretion (stream vs show-on-complete)

#### Active users display
- Same placement and component pattern as Phase 12's document avatar stack — consistency across features
- Same max avatar count before "+N" overflow as documents
- Colored ring on each avatar matching the user's cursor color — easy to map avatar to pointer on canvas
- Clicking a user's avatar pans the canvas to center on where that user is working (jump-to-user)

#### Idle & stale behavior
- Pointer fades to transparent after a timeout period when user stops moving
- Stale user removal matches Phase 12's document timeout (10s) for consistency
- No re-entry animation — cursor simply resumes at full visibility when user moves again
- Claude has discretion on whether idle pointers show reduced opacity vs fully faded

### Claude's Discretion
- Freehand drawing sync strategy (stream live points vs show-on-complete)
- Idle pointer opacity treatment (semi-transparent vs full fade)
- Exact fade timeout duration for idle pointers
- Lock indicator visual design (how locked elements appear to other users)
- Pointer smoothing/interpolation for network latency

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| y-excalidraw | Latest | Yjs binding for Excalidraw | Official Yjs binding for Excalidraw element sync and awareness |
| @excalidraw/excalidraw | 0.18.0 | Diagram editor | Already installed, provides onChange/onPointerUpdate callbacks for collaboration |
| yjs | ^13.6.29 | CRDT document sync | Already installed in Phase 11, y-excalidraw peer dependency |
| y-partykit | ^0.0.33 | WebSocket provider | Already deployed in Phase 11, handles Yjs transport over PartyKit |
| color-hash | ^2.0.2 | Consistent color generation | Already installed in Phase 12, deterministic user colors |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| y-indexeddb | ^9.0.12 | Offline persistence | Already installed, apply same pattern as Phase 12 for diagram caching |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| y-excalidraw | Custom sync via onChange | y-excalidraw handles element-level CRDT reconciliation, version conflict resolution, and awareness API — custom solution would reimplement solved problems |
| Custom pointer overlay | Third-party cursor library | Excalidraw-specific coordinate transformation required, custom implementation more maintainable |
| Existing useYjsProvider | Separate PartyKit connection | Reusing infrastructure reduces complexity, proven in Phase 11/12 |

**Installation:**
```bash
npm install y-excalidraw
```

**Note:** All other dependencies already installed in Phases 11 and 12.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── hooks/
│   ├── use-yjs-provider.ts               # EXISTS from Phase 11 (reuse)
│   ├── use-diagram-collaboration.ts      # NEW: Excalidraw + y-excalidraw integration
│   └── use-diagram-cursor-awareness.ts   # NEW: Excalidraw-specific awareness (pointer coords + locked elements)
├── pages/App/Diagram/
│   ├── ExcalidrawEditor.tsx              # UPDATE: Integrate y-excalidraw binding
│   ├── DiagramCursorOverlay.tsx          # NEW: Render remote pointers with coordinate transform
│   ├── ActiveUsers.tsx                   # REUSE from Phase 12 (add jump-to-user click handler)
│   └── ConnectionStatus.tsx              # REUSE from Phase 12 (identical pattern)
└── lib/
    ├── user-colors.ts                    # EXISTS from Phase 12 (reuse singleton)
    └── canvas-coordinates.ts             # NEW: Screen-to-canvas coordinate transform utilities
```

### Pattern 1: y-excalidraw Integration
**What:** Bind Yjs Y.Array to Excalidraw element array with awareness
**When to use:** Every diagram editor instance
**Example:**
```typescript
// Source: https://github.com/RahulBadenkal/y-excalidraw
import { ExcalidrawBinding } from "y-excalidraw";
import { useYjsProvider } from "@/hooks/use-yjs-provider";
import * as Y from "yjs";

const { yDoc, provider } = useYjsProvider({
  resourceType: "diagram",
  resourceId: diagramId,
});

const yElements = yDoc.getArray<Y.Map<any>>("elements");
const yAssets = yDoc.getMap("assets");

// After excalidrawAPI is available
useEffect(() => {
  if (!excalidrawAPI || !provider) return;

  const binding = new ExcalidrawBinding(
    yElements,
    yAssets,
    excalidrawAPI,
    provider.awareness,
    {
      excalidrawDom: document.querySelector(".excalidraw-wrapper")!,
    }
  );

  // Connect onPointerUpdate callback for cursor sync
  // (pass binding.onPointerUpdate to Excalidraw onPointerUpdate prop)

  return () => {
    binding.destroy();
  };
}, [excalidrawAPI, provider, yElements, yAssets]);
```

### Pattern 2: Canvas Coordinate Transformation
**What:** Transform screen coordinates to canvas coordinates accounting for pan/zoom
**When to use:** Rendering remote pointers, click-to-jump-to-user
**Example:**
```typescript
// Source: https://roblouie.com/article/617/transforming-mouse-coordinates-to-canvas-coordinates/
// and https://www.steveruiz.me/posts/zoom-ui

interface Camera {
  x: number; // camera pan X
  y: number; // camera pan Y
  z: number; // zoom level (1 = 100%)
}

// Convert screen coords to canvas coords
function screenToCanvas(screenPoint: Point, camera: Camera): Point {
  return {
    x: screenPoint.x / camera.z - camera.x,
    y: screenPoint.y / camera.z - camera.y,
  };
}

// Convert canvas coords to screen coords (for rendering)
function canvasToScreen(canvasPoint: Point, camera: Camera): Point {
  return {
    x: (canvasPoint.x + camera.x) * camera.z,
    y: (canvasPoint.y + camera.y) * camera.z,
  };
}

// Get camera state from Excalidraw appState
const appState = excalidrawAPI.getAppState();
const camera = {
  x: appState.scrollX,
  y: appState.scrollY,
  z: appState.zoom.value,
};
```

### Pattern 3: Custom Pointer Overlay Rendering
**What:** Render remote cursors with Figma-style arrows and name labels
**When to use:** Display awareness cursors from other users
**Example:**
```typescript
// Source: https://mskelton.dev/blog/building-figma-multiplayer-cursors
// Adapted for Excalidraw canvas coordinates

interface RemotePointer {
  clientId: number;
  user: { name: string; color: string };
  pointer: { x: number; y: number } | null; // canvas coordinates
  lastUpdate: number;
  isIdle: boolean;
}

function DiagramCursorOverlay({ cursors, camera }: Props) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {cursors.map((cursor) => {
        if (!cursor.pointer) return null;

        // Transform canvas coords to screen coords for rendering
        const screenPos = canvasToScreen(cursor.pointer, camera);

        // Only render if in viewport
        if (screenPos.x < 0 || screenPos.y < 0 ||
            screenPos.x > window.innerWidth ||
            screenPos.y > window.innerHeight) {
          return null;
        }

        return (
          <div
            key={cursor.clientId}
            className="absolute transition-opacity duration-200"
            style={{
              left: `${screenPos.x}px`,
              top: `${screenPos.y}px`,
              opacity: cursor.isIdle ? 0.3 : 1, // Fade idle cursors
            }}
          >
            {/* SVG arrow cursor */}
            <svg width="24" height="36" viewBox="0 0 24 36" fill="none">
              <path
                d="M0 0L0 24L9 15L15 27L18 25L12 13L24 10L0 0Z"
                fill={cursor.user.color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>
            {/* Name label */}
            <div
              className="absolute top-5 left-6 px-2 py-1 rounded text-xs text-white whitespace-nowrap"
              style={{ backgroundColor: cursor.user.color }}
            >
              {cursor.user.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Pattern 4: Lock-on-Select Awareness
**What:** Broadcast locked element IDs via Awareness, render lock indicators for remote users
**When to use:** Prevent concurrent editing conflicts
**Example:**
```typescript
// Broadcast locked elements via awareness
awareness.setLocalStateField("lockedElements", {
  elementIds: ["element-id-1", "element-id-2"],
  timestamp: Date.now(),
});

// Observe locked elements from remote users
awareness.on("change", () => {
  const states = awareness.getStates();
  const lockedElementIds = new Set<string>();

  states.forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const locked = state.lockedElements?.elementIds || [];
    locked.forEach((id: string) => lockedElementIds.add(id));
  });

  // Render lock indicators on elements in lockedElementIds
  // (overlay with lock icon or colored border)
});

// Claude's discretion: Lock indicator visual design
// Option 1: Border overlay with lock icon
// Option 2: Semi-transparent colored overlay with user's color + lock icon
// Option 3: Corner badge with user avatar + lock icon
```

### Pattern 5: Jump-to-User on Avatar Click
**What:** Pan canvas to center on remote user's cursor position
**When to use:** User clicks avatar in ActiveUsers component
**Example:**
```typescript
// Source: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
function handleJumpToUser(remoteUser: RemoteUser) {
  if (!remoteUser.pointer || !excalidrawAPI) return;

  // Get current appState to preserve zoom level
  const currentAppState = excalidrawAPI.getAppState();

  // Calculate new scroll position to center on remote cursor
  const viewportCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };

  const newScrollX = viewportCenter.x / currentAppState.zoom.value - remoteUser.pointer.x;
  const newScrollY = viewportCenter.y / currentAppState.zoom.value - remoteUser.pointer.y;

  // Update scroll position with animation
  excalidrawAPI.updateScene({
    appState: {
      scrollX: newScrollX,
      scrollY: newScrollY,
      // Preserve current zoom
      zoom: currentAppState.zoom,
    },
  });
}

// Alternative: Use scrollToContent if user has selected element
// excalidrawAPI.scrollToContent(targetElements, { animate: true, duration: 300 });
```

### Pattern 6: Idle Pointer Detection
**What:** Track pointer movement timestamps and apply fade after timeout
**When to use:** Detect idle vs active cursors for visual feedback
**Example:**
```typescript
// Claude's discretion: Idle timeout duration (recommend 30s to match Phase 12)
const IDLE_TIMEOUT = 30000; // 30 seconds

interface PointerTracker {
  position: { x: number; y: number };
  timestamp: number;
}

const pointerHistory = useRef<Map<number, PointerTracker>>(new Map());

awareness.on("change", ({ updated }) => {
  const now = Date.now();

  updated.forEach((clientId) => {
    const state = awareness.getStates().get(clientId);
    if (!state?.pointer) return;

    const existing = pointerHistory.current.get(clientId);
    const positionChanged =
      !existing ||
      existing.position.x !== state.pointer.x ||
      existing.position.y !== state.pointer.y;

    if (positionChanged) {
      pointerHistory.current.set(clientId, {
        position: state.pointer,
        timestamp: now,
      });
    }
  });
});

// Check idle state
function isPointerIdle(clientId: number): boolean {
  const tracker = pointerHistory.current.get(clientId);
  if (!tracker) return false;
  return Date.now() - tracker.timestamp > IDLE_TIMEOUT;
}

// Claude's discretion: Opacity treatment
// Option 1: opacity: 0.3 (semi-transparent, recommended)
// Option 2: opacity: 0 (fully faded)
// Recommendation: semi-transparent (0.3) to show user still present
```

### Anti-Patterns to Avoid
- **Manual element reconciliation:** Excalidraw's `reconcileElements` is already integrated into y-excalidraw binding. Don't call it manually or you'll create duplicate reconciliation logic.
- **Polling awareness for cursor updates:** Use awareness.on("change") event listener instead. Polling creates unnecessary overhead and adds latency.
- **Screen coordinates in awareness state:** Store canvas coordinates (accounting for pan/zoom) in awareness, not raw screen coordinates. Screen coords break across different viewport sizes.
- **Global coordinate transformation:** Canvas camera state (scrollX, scrollY, zoom) changes frequently. Transform coordinates just-in-time during render, don't cache transformed values.
- **Cursor rendering inside Excalidraw canvas:** Render cursor overlay as sibling div to Excalidraw, not inside canvas. Inside-canvas cursors get clipped, zoomed incorrectly, and interfere with drawing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Excalidraw element sync | Custom onChange debounce + send to server | y-excalidraw ExcalidrawBinding | Handles element-level CRDT reconciliation, version conflict resolution (versionNonce), undo/redo integration |
| User color assignment | Random colors per session | Reuse Phase 12's getUserColor (ColorHash) | Consistency requirement (AWARE-03): same colors in documents and diagrams |
| Cursor awareness state | Custom WebSocket message protocol | Yjs Awareness API | Built-in timeout/cleanup, automatic stale client removal, proven in Phase 12 |
| Coordinate transformation | Manual matrix math | Canvas coordinate utilities (screenToCanvas/canvasToScreen) | Excalidraw's pan/zoom uses simple offset model, not full affine transforms |
| Active users UI | New component | Reuse Phase 12's ActiveUsers component | Consistency requirement: same avatar stack pattern across features |

**Key insight:** y-excalidraw solves element sync, but cursor rendering is custom (Excalidraw doesn't provide built-in multiplayer cursor UI). Reuse Phase 12 patterns (colors, awareness hooks, ActiveUsers) for consistency.

## Common Pitfalls

### Pitfall 1: Screen Coordinates in Awareness Breaking Cross-Viewport
**What goes wrong:** Storing raw screen coordinates (clientX/clientY) in awareness causes cursors to render at wrong positions when users have different viewport sizes or zoom levels.
**Why it happens:** Screen coordinates are relative to browser window, not canvas. A pointer at (500, 300) screen position could be at (100, 50) canvas position after accounting for pan/zoom.
**How to avoid:** Store canvas coordinates in awareness. Use `screenToCanvas()` to convert pointer events before broadcasting, then `canvasToScreen()` when rendering remote cursors.
**Warning signs:** Remote cursors jump to wrong positions when users pan/zoom or have different screen sizes.

### Pitfall 2: Cursor Overlay Rendering Inside Excalidraw Canvas
**What goes wrong:** Cursors rendered inside Excalidraw canvas get clipped by viewport bounds, zoomed incorrectly, and block drawing interactions.
**Why it happens:** Developers assume cursors should be children of canvas element to inherit positioning.
**How to avoid:** Render cursor overlay as absolute-positioned sibling div covering the same area as Excalidraw. Use `pointer-events: none` to prevent blocking interactions. Transform canvas coordinates to screen coordinates for positioning.
**Warning signs:** Cursors disappear when zooming, get clipped at canvas edges, or block mouse events.

### Pitfall 3: Not Handling Excalidraw's Initial Data with y-excalidraw
**What goes wrong:** Setting Excalidraw's `initialData` directly conflicts with y-excalidraw's element binding, causing elements to duplicate or revert on load.
**Why it happens:** y-excalidraw manages element state via Yjs array. Passing separate initialData creates two sources of truth.
**How to avoid:** Use y-excalidraw's `yjsToExcalidraw()` utility to convert Yjs array to initial data format. Only set initialData once before binding is created. Let y-excalidraw handle all subsequent updates.
**Warning signs:** Elements appear twice, edits revert to old state after page reload, new drawings disappear on sync.

### Pitfall 4: Forgetting to Update Camera State on Pan/Zoom
**What goes wrong:** Remote cursors stay fixed in screen position while user pans/zooms, making them appear to "drift" across canvas.
**Why it happens:** Cursor overlay uses cached camera state (scrollX, scrollY, zoom) that becomes stale when user interacts with canvas.
**How to avoid:** Subscribe to Excalidraw appState changes (onChange callback) and update camera state for coordinate transformation. Re-render cursor overlay whenever camera changes.
**Warning signs:** Remote cursors don't move when panning canvas, appear at wrong positions after zooming.

### Pitfall 5: Lock-on-Select Without Unlocking on Deselect
**What goes wrong:** Elements remain locked indefinitely after user deselects them, blocking all remote users from editing.
**Why it happens:** Developer broadcasts locked element IDs on selection but forgets to clear them on deselection or element deletion.
**How to avoid:** Track Excalidraw's `appState.selectedElementIds` and update awareness.lockedElements whenever selection changes. Clear locked elements when selection is empty or user disconnects (awareness cleanup).
**Warning signs:** Elements permanently locked, users can't select elements that appear unlocked visually.

### Pitfall 6: Excalidraw onChange Triggering on Every Awareness Update
**What goes wrong:** Excalidraw's onChange callback fires excessively, causing performance issues and infinite sync loops.
**Why it happens:** y-excalidraw updates Excalidraw scene when remote changes arrive, triggering onChange. If onChange broadcasts changes back to Yjs, it creates a loop.
**How to avoid:** y-excalidraw binding handles onChange internally. Don't add separate onChange handler for sync. If you need onChange for other purposes (e.g., debounced auto-save), check if update originated from local user before taking action.
**Warning signs:** CPU usage spikes during collaboration, network traffic loops, React renders excessively.

### Pitfall 7: Freehand Drawing Performance with Live Streaming
**What goes wrong:** Streaming every point of a freehand stroke in real-time causes network/CPU overload with dozens of updates per second.
**Why it happens:** Freehand drawing generates many points rapidly (mouse move events fire 60+ times/second).
**How to avoid:** Claude's discretion decision. Recommendation: Show completed stroke only (y-excalidraw default behavior). Alternative: Throttle pointer updates to max 10/second if streaming is desired. y-excalidraw syncs at element level, so in-progress drawing won't sync until stroke completes — this is acceptable for freehand.
**Warning signs:** Laggy cursor during freehand drawing, network saturation, CPU spikes.

## Code Examples

Verified patterns from official sources:

### y-excalidraw Setup with PartyKit
```typescript
// Source: https://github.com/RahulBadenkal/y-excalidraw
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import { useYjsProvider } from "@/hooks/use-yjs-provider";
import { Excalidraw } from "@excalidraw/excalidraw";
import * as Y from "yjs";

function DiagramEditor({ diagramId }: { diagramId: string }) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const { yDoc, provider, isConnected } = useYjsProvider({
    resourceType: "diagram",
    resourceId: diagramId,
  });

  const yElements = useMemo(() => yDoc.getArray<Y.Map<any>>("elements"), [yDoc]);
  const yAssets = useMemo(() => yDoc.getMap("assets"), [yDoc]);

  // Set up y-excalidraw binding
  useEffect(() => {
    if (!excalidrawAPI || !provider) return;

    const excalidrawDom = document.querySelector(".excalidraw-wrapper");
    if (!excalidrawDom) return;

    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      excalidrawAPI,
      provider.awareness,
      {
        excalidrawDom: excalidrawDom as HTMLElement,
      }
    );

    return () => {
      binding.destroy();
    };
  }, [excalidrawAPI, provider, yElements, yAssets]);

  // Set awareness user info
  useEffect(() => {
    if (!provider) return;

    const userColor = getUserColor(currentUser._id);

    provider.awareness.setLocalStateField("user", {
      name: currentUser.name,
      color: userColor,
    });
  }, [provider, currentUser]);

  return (
    <div className="excalidraw-wrapper h-full">
      <Excalidraw
        excalidrawAPI={setExcalidrawAPI}
        initialData={yjsToExcalidraw(yElements)} // Convert Yjs to Excalidraw format
      />
    </div>
  );
}
```

### Canvas Coordinate Utilities
```typescript
// Source: https://roblouie.com/article/617/transforming-mouse-coordinates-to-canvas-coordinates/
// Adapted for Excalidraw AppState

interface Point {
  x: number;
  y: number;
}

interface Camera {
  x: number; // scrollX
  y: number; // scrollY
  z: number; // zoom.value
}

export function getCameraFromAppState(appState: AppState): Camera {
  return {
    x: appState.scrollX,
    y: appState.scrollY,
    z: appState.zoom.value,
  };
}

export function screenToCanvas(screenPoint: Point, camera: Camera): Point {
  return {
    x: screenPoint.x / camera.z - camera.x,
    y: screenPoint.y / camera.z - camera.y,
  };
}

export function canvasToScreen(canvasPoint: Point, camera: Camera): Point {
  return {
    x: (canvasPoint.x + camera.x) * camera.z,
    y: (canvasPoint.y + camera.y) * camera.z,
  };
}

// Example usage: Convert mouse event to canvas coordinates for awareness
function handlePointerMove(e: PointerEvent, excalidrawAPI: ExcalidrawImperativeAPI) {
  const screenPoint = { x: e.clientX, y: e.clientY };
  const camera = getCameraFromAppState(excalidrawAPI.getAppState());
  const canvasPoint = screenToCanvas(screenPoint, camera);

  awareness.setLocalStateField("pointer", canvasPoint);
}
```

### Custom Cursor Awareness Hook
```typescript
// Adapted from Phase 12's use-cursor-awareness.ts for Excalidraw specifics
import type { Awareness } from "y-protocols/awareness";
import { useCallback, useEffect, useRef, useState } from "react";

interface RemotePointer {
  clientId: number;
  name: string;
  color: string;
  pointer: { x: number; y: number } | null; // canvas coordinates
  lockedElements: string[]; // element IDs locked by this user
  lastUpdate: number;
  isIdle: boolean;
}

const STALE_TIMEOUT = 10000; // 10s to match Phase 12
const IDLE_TIMEOUT = 30000; // 30s to match Phase 12

export function useDiagramCursorAwareness(awareness: Awareness | null) {
  const [remotePointers, setRemotePointers] = useState<RemotePointer[]>([]);
  const clientTimestamps = useRef<Map<number, number>>(new Map());
  const pointerPositions = useRef<Map<number, { position: { x: number; y: number }; timestamp: number }>>(new Map());

  const updatePointers = useCallback(() => {
    if (!awareness) return;

    const states = awareness.getStates();
    const now = Date.now();
    const localClientId = awareness.clientID;
    const pointers: RemotePointer[] = [];

    states.forEach((state: any, clientId: number) => {
      if (clientId === localClientId) return;

      const lastUpdate = clientTimestamps.current.get(clientId) ?? now;

      // Remove stale clients (>10s)
      if (now - lastUpdate > STALE_TIMEOUT) return;

      const user = state.user;
      const pointer = state.pointer ?? null;
      const lockedElements = state.lockedElements?.elementIds || [];

      if (user) {
        let isIdle = false;
        if (pointer) {
          const pointerData = pointerPositions.current.get(clientId);
          if (pointerData) {
            const moved =
              pointerData.position.x !== pointer.x ||
              pointerData.position.y !== pointer.y;

            if (!moved) {
              isIdle = now - pointerData.timestamp > IDLE_TIMEOUT;
            }
          }
        }

        pointers.push({
          clientId,
          name: user.name,
          color: user.color,
          pointer,
          lockedElements,
          lastUpdate,
          isIdle,
        });
      }
    });

    setRemotePointers(pointers);
  }, [awareness]);

  useEffect(() => {
    if (!awareness) return;

    const handleChange = ({ added, updated, removed }: any) => {
      const now = Date.now();

      [...added, ...updated].forEach((clientId: number) => {
        clientTimestamps.current.set(clientId, now);

        const state = awareness.getStates().get(clientId);
        if (state?.pointer) {
          const existing = pointerPositions.current.get(clientId);
          const moved =
            !existing ||
            existing.position.x !== state.pointer.x ||
            existing.position.y !== state.pointer.y;

          if (moved) {
            pointerPositions.current.set(clientId, {
              position: state.pointer,
              timestamp: now,
            });
          }
        }
      });

      removed.forEach((clientId: number) => {
        clientTimestamps.current.delete(clientId);
        pointerPositions.current.delete(clientId);
      });

      updatePointers();
    };

    awareness.on("change", handleChange);

    // Re-check every second for idle/stale state
    const interval = setInterval(updatePointers, 1000);

    return () => {
      awareness.off("change", handleChange);
      clearInterval(interval);
      setRemotePointers([]);
    };
  }, [awareness, updatePointers]);

  return { remotePointers };
}
```

### Cursor Overlay Component
```typescript
// Source: https://mskelton.dev/blog/building-figma-multiplayer-cursors (adapted)
import { canvasToScreen, getCameraFromAppState } from "@/lib/canvas-coordinates";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

interface DiagramCursorOverlayProps {
  cursors: RemotePointer[];
  excalidrawAPI: ExcalidrawImperativeAPI;
}

export function DiagramCursorOverlay({ cursors, excalidrawAPI }: DiagramCursorOverlayProps) {
  const appState = excalidrawAPI.getAppState();
  const camera = getCameraFromAppState(appState);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {cursors.map((cursor) => {
        if (!cursor.pointer) return null;

        // Transform canvas coords to screen coords
        const screenPos = canvasToScreen(cursor.pointer, camera);

        // Only render if in viewport
        if (
          screenPos.x < 0 ||
          screenPos.y < 0 ||
          screenPos.x > window.innerWidth ||
          screenPos.y > window.innerHeight
        ) {
          return null;
        }

        return (
          <div
            key={cursor.clientId}
            className="absolute transition-opacity duration-200"
            style={{
              left: `${screenPos.x}px`,
              top: `${screenPos.y}px`,
              opacity: cursor.isIdle ? 0.3 : 1, // Semi-transparent when idle
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
                strokeLinejoin="round"
              />
            </svg>
            {/* Name label */}
            <div
              className="absolute top-5 left-6 px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap shadow-md"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

### Jump-to-User Implementation
```typescript
// Source: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
function handleAvatarClick(remotePointer: RemotePointer, excalidrawAPI: ExcalidrawImperativeAPI) {
  if (!remotePointer.pointer) return;

  const currentAppState = excalidrawAPI.getAppState();
  const viewportCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };

  // Calculate scroll offset to center remote pointer in viewport
  const newScrollX = viewportCenter.x / currentAppState.zoom.value - remotePointer.pointer.x;
  const newScrollY = viewportCenter.y / currentAppState.zoom.value - remotePointer.pointer.y;

  excalidrawAPI.updateScene({
    appState: {
      scrollX: newScrollX,
      scrollY: newScrollY,
    },
  });
}

// Usage: Pass to ActiveUsers component
<ActiveUsers
  remoteUsers={remotePointers.map(p => ({ ...p, cursor: p.pointer }))}
  currentUser={currentUser}
  onUserClick={(user) => {
    const pointer = remotePointers.find(p => p.clientId === user.clientId);
    if (pointer) handleAvatarClick(pointer, excalidrawAPI);
  }}
/>
```

### Lock Indicator Rendering
```typescript
// Claude's discretion: Lock indicator design
// Recommendation: Corner badge with lock icon + user color

function DiagramLockOverlay({ lockedElements, cursors, excalidrawAPI }: Props) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {lockedElements.map((elementId) => {
        const element = excalidrawAPI
          .getSceneElements()
          .find((el) => el.id === elementId);
        if (!element) return null;

        const cursor = cursors.find((c) => c.lockedElements.includes(elementId));
        if (!cursor) return null;

        // Get element bounds and transform to screen coords
        const bounds = element; // has x, y, width, height
        const camera = getCameraFromAppState(excalidrawAPI.getAppState());
        const topLeft = canvasToScreen({ x: bounds.x, y: bounds.y }, camera);

        return (
          <div
            key={elementId}
            className="absolute"
            style={{
              left: `${topLeft.x}px`,
              top: `${topLeft.y}px`,
            }}
          >
            {/* Lock badge */}
            <div
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white shadow-md"
              style={{ backgroundColor: cursor.color }}
            >
              <Lock className="h-3 w-3" />
              {cursor.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual Convex sync (ExcalidrawEditor.tsx) | y-excalidraw + Yjs CRDT | Phase 13 | Real-time element sync, automatic conflict resolution, no reconcileElements polling |
| No cursor awareness | Yjs Awareness API + custom overlay | Phase 13 | Real-time pointer tracking, lock-on-select conflict prevention |
| Separate diagram colors | ColorHash singleton from Phase 12 | Reused | Consistent user colors across documents and diagrams (AWARE-03) |
| Custom active users UI | ActiveUsers component from Phase 12 | Reused | Consistent avatar stack pattern across features |

**Deprecated/outdated:**
- Manual debounced save with reconcileElements (ExcalidrawEditor.tsx lines 69-86): Replaced by y-excalidraw automatic sync
- Convex `content` field for diagrams: Becomes metadata-only (similar to documents in Phase 12), Yjs/PartyKit is source of truth

## Open Questions

1. **Freehand drawing sync strategy**
   - What we know: y-excalidraw syncs at element level, completed strokes sync automatically
   - What's unclear: Whether in-progress freehand strokes can show live preview without custom implementation
   - Recommendation: Accept y-excalidraw default (show completed stroke only). Custom streaming would require pointer-level sync outside y-excalidraw, adding complexity. Users can see remote cursor position while drawing, which provides sufficient awareness.

2. **Lock indicator placement with many locked elements**
   - What we know: Lock indicators render at element top-left corner
   - What's unclear: How to handle visual clutter when 10+ elements locked by different users
   - Recommendation: Show lock indicator only when hovering over locked element, or limit to 3 visible indicators with "+N more" badge. Test during implementation to determine best UX.

3. **Excalidraw onPointerUpdate vs manual pointer tracking**
   - What we know: Excalidraw provides onPointerUpdate callback, y-excalidraw provides binding.onPointerUpdate method
   - What's unclear: Whether y-excalidraw.binding.onPointerUpdate automatically integrates with Excalidraw's onPointerUpdate prop, or if manual wiring is needed
   - Recommendation: Review y-excalidraw source code during implementation. If binding.onPointerUpdate is a passthrough function, pass it directly to Excalidraw's onPointerUpdate prop.

4. **IndexedDB persistence for diagrams**
   - What we know: Phase 12 uses y-indexeddb for offline document editing, same pattern applicable to diagrams
   - What's unclear: Whether diagram offline editing is priority, or if connection-required mode is acceptable
   - Recommendation: Implement IndexedDB persistence (consistency with documents). Add in useDiagramCollaboration hook following Phase 12 pattern. Low effort, high value for offline resilience.

## Sources

### Primary (HIGH confidence)
- y-excalidraw GitHub: https://github.com/RahulBadenkal/y-excalidraw
- Excalidraw Collaboration Discussion: https://github.com/excalidraw/excalidraw/discussions/3879
- Excalidraw Props API: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props
- Excalidraw API Reference: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
- Excalidraw Utils API: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils
- Canvas Coordinate Transformation: https://roblouie.com/article/617/transforming-mouse-coordinates-to-canvas-coordinates/
- Zoom UI Coordinate Systems: https://www.steveruiz.me/posts/zoom-ui
- y-partykit API Docs: https://docs.partykit.io/reference/y-partykit-api/
- Phase 12 Research (ColorHash, ActiveUsers, Awareness patterns): .planning/phases/12-document-multiplayer-cursors-yjs-migration/12-RESEARCH.md

### Secondary (MEDIUM confidence)
- Building Figma Multiplayer Cursors: https://mskelton.dev/blog/building-figma-multiplayer-cursors
- Excalidraw Multiplayer Blog Post: https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature
- Excalidraw Yjs Starter (example implementation): https://github.com/mizuka-wu/excalidraw-yjs-starter
- Collaborative Editing Conflict Prevention: https://tryhoverify.com/blog/conflict-resolution-in-real-time-collaborative-editing/
- Excalidraw Element Versioning (versionNonce): https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils (inferred from discussions)

### Tertiary (LOW confidence - informational only)
- Excalidraw CRDT RFC Discussion: https://github.com/excalidraw/excalidraw/issues/3537
- Hybrid Semantic Conflict Prevention: https://link.springer.com/content/pdf/10.1007/978-3-030-92638-0_7.pdf
- Canvas Panning and Zooming Tutorial: https://harrisonmilbradt.com/blog/canvas-panning-and-zooming

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - y-excalidraw is established binding for Excalidraw + Yjs, PartyKit infrastructure proven in Phase 11/12
- Architecture: HIGH - Excalidraw API well-documented, coordinate transformation is standard canvas technique, Phase 12 patterns reusable
- Pitfalls: MEDIUM-HIGH - Screen vs canvas coordinate confusion is common, y-excalidraw initialData integration needs testing, lock indicator design is Claude's discretion

**Research date:** 2026-02-11
**Valid until:** 2026-03-13 (30 days - stable ecosystem, y-excalidraw mature, Excalidraw 0.18.0 current)

**Phase 11/12 foundation:**
- Phase 11: PartyKit server deployed with Yjs persistence, useYjsProvider hook ready
- Phase 12: ColorHash singleton established, ActiveUsers component pattern proven, useCursorAwareness pattern for idle/stale detection

**Key unknowns requiring validation during planning/execution:**
1. y-excalidraw binding.onPointerUpdate integration with Excalidraw onPointerUpdate prop (likely passthrough, verify during implementation)
2. Lock indicator visual design (Claude's discretion - recommend corner badge + hover-to-show for clutter reduction)
3. Freehand drawing sync (recommend accept y-excalidraw default: completed stroke only)
4. Idle pointer opacity (Claude's discretion - recommend 0.3 semi-transparent vs 0 fully faded)
