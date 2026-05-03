import type { AppState } from "@excalidraw/excalidraw/types";

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number; // scrollX
  y: number; // scrollY
  z: number; // zoom.value
}

/**
 * Extract camera state from Excalidraw AppState.
 * Camera represents the viewport's position and zoom level.
 */
export function getCameraFromAppState(appState: AppState): Camera {
  return {
    x: appState.scrollX,
    y: appState.scrollY,
    z: appState.zoom.value,
  };
}

/**
 * Convert screen coordinates to canvas coordinates.
 * Screen coordinates are relative to the browser window.
 * Canvas coordinates account for pan (scroll) and zoom.
 *
 * IMPORTANT: Store canvas coordinates in awareness, not screen coords.
 * Screen coords break across different viewport sizes.
 */
export function screenToCanvas(screenPoint: Point, camera: Camera): Point {
  return {
    x: screenPoint.x / camera.z - camera.x,
    y: screenPoint.y / camera.z - camera.y,
  };
}

/**
 * Convert canvas coordinates to screen coordinates for rendering.
 * Used when displaying remote cursors - transform canvas position
 * to screen position accounting for current viewport pan/zoom.
 */
export function canvasToScreen(canvasPoint: Point, camera: Camera): Point {
  return {
    x: (canvasPoint.x + camera.x) * camera.z,
    y: (canvasPoint.y + camera.y) * camera.z,
  };
}
