"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { Theme } from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import type { Awareness } from "y-protocols/awareness";
import type YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { useDiagramCursorAwareness } from "@/hooks/use-diagram-cursor-awareness";
import { DiagramCursorOverlay } from "./DiagramCursorOverlay";
import { DiagramLockOverlay } from "./DiagramLockOverlay";
import { getCameraFromAppState } from "@/lib/canvas-coordinates";

interface ExcalidrawEditorProps {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness | null;
  provider: YPartyKitProvider | null;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
}

export function ExcalidrawEditor({
  yElements,
  yAssets,
  awareness,
  provider,
  onExcalidrawAPI,
}: ExcalidrawEditorProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const { resolvedTheme } = useTheme();
  const { remotePointers } = useDiagramCursorAwareness(awareness);

  // Notify parent when API is ready
  useEffect(() => {
    if (excalidrawAPI) {
      onExcalidrawAPI(excalidrawAPI);
    }
  }, [excalidrawAPI, onExcalidrawAPI]);

  // Set up y-excalidraw binding and pointer tracking
  useEffect(() => {
    if (!excalidrawAPI || !provider || !yElements || !yAssets || !awareness) return;

    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      excalidrawAPI,
      provider.awareness
    );

    // Track pointer updates via binding's onPointerUpdate handler
    const handlePointerMove = (e: PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const appState = excalidrawAPI.getAppState();
      const camera = getCameraFromAppState(appState);

      // Convert screen coords to canvas coords
      awareness.setLocalStateField("pointer", {
        x: x / camera.z - camera.x,
        y: y / camera.z - camera.y,
      });
    };

    const excalidrawDom = document.querySelector(".excalidraw-wrapper") as HTMLElement;
    if (excalidrawDom) {
      excalidrawDom.addEventListener("pointermove", handlePointerMove);
    }

    return () => {
      binding.destroy();
      if (excalidrawDom) {
        excalidrawDom.removeEventListener("pointermove", handlePointerMove);
      }
    };
  }, [excalidrawAPI, provider, yElements, yAssets, awareness]);

  // Clean up locked elements on unmount
  useEffect(() => {
    return () => {
      if (awareness) {
        awareness.setLocalStateField("lockedElements", { elementIds: [] });
      }
    };
  }, [awareness]);

  return (
    <div className="relative h-full w-full">
      <div className="h-full">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          theme={resolvedTheme as Theme}
          initialData={{
            elements: yElements ? yjsToExcalidraw(yElements) : [],
          }}
          onChange={(_elements, appState) => {
            // Update locked elements based on selection
            if (awareness) {
              const selectedElementIds = appState.selectedElementIds;
              if (!selectedElementIds || Object.keys(selectedElementIds).length === 0) {
                awareness.setLocalStateField("lockedElements", { elementIds: [] });
              } else {
                const elementIds = Object.keys(selectedElementIds).filter(
                  (id) => selectedElementIds[id]
                );
                awareness.setLocalStateField("lockedElements", { elementIds });
              }
            }
          }}
          zenModeEnabled={true}
          UIOptions={{
            tools: { image: false },
            canvasActions: {
              loadScene: false,
              export: {
                saveFileToDisk: true,
              },
            },
          }}
        />
      </div>

      {/* Cursor overlay - sibling to Excalidraw, not child */}
      <DiagramCursorOverlay cursors={remotePointers} excalidrawAPI={excalidrawAPI ?? null} />

      {/* Lock overlay - sibling to Excalidraw, not child */}
      <DiagramLockOverlay cursors={remotePointers} excalidrawAPI={excalidrawAPI ?? null} />
    </div>
  );
}
