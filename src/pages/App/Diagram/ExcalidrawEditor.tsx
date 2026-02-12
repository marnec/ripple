"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { Theme } from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import type { Awareness } from "y-protocols/awareness";
import type YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";

interface ExcalidrawEditorProps {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness | null;
  provider: YPartyKitProvider | null;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  viewModeEnabled?: boolean;
}

export function ExcalidrawEditor({
  yElements,
  yAssets,
  awareness,
  provider,
  onExcalidrawAPI,
  viewModeEnabled,
}: ExcalidrawEditorProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const { resolvedTheme } = useTheme();
  const bindingRef = useRef<ExcalidrawBinding | null>(null);

  // Notify parent when API is ready
  useEffect(() => {
    if (excalidrawAPI) {
      onExcalidrawAPI(excalidrawAPI);
    }
  }, [excalidrawAPI, onExcalidrawAPI]);

  // Set up y-excalidraw binding — it handles:
  // - Bidirectional element/asset sync
  // - Awareness → Excalidraw collaborators map (cursors, selections)
  // - selectedElementIds → awareness (on onChange)
  useEffect(() => {
    if (!excalidrawAPI || !provider || !yElements || !yAssets || !awareness) return;

    const binding = new ExcalidrawBinding(
      yElements,
      yAssets,
      excalidrawAPI,
      provider.awareness
    );
    bindingRef.current = binding;

    return () => {
      binding.destroy();
      bindingRef.current = null;
    };
  }, [excalidrawAPI, provider, yElements, yAssets, awareness]);

  // Broadcast pointer position to other users via awareness
  // (The binding exposes onPointerUpdate but doesn't auto-connect it)
  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
      if (bindingRef.current) {
        bindingRef.current.onPointerUpdate(payload);
      }
    },
    [],
  );

  return (
    <div className="h-full w-full">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        isCollaborating={true}
        theme={resolvedTheme as Theme}
        initialData={{
          elements: yElements ? yjsToExcalidraw(yElements) : [],
        }}
        onPointerUpdate={handlePointerUpdate}
        viewModeEnabled={viewModeEnabled}
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
  );
}
