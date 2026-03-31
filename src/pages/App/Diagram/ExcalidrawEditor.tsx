"use client";

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { Theme } from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import type { Awareness } from "y-protocols/awareness";
import type YProvider from "y-partyserver/provider";
import type * as Y from "yjs";


interface ExcalidrawEditorProps {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness | null;
  provider: YProvider | null;
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

  // Notify parent directly in callback (event handler, not effect)
  const handleExcalidrawAPI = (api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
    onExcalidrawAPI(api);
  };

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
  const handlePointerUpdate = (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
    if (bindingRef.current) {
      bindingRef.current.onPointerUpdate(payload);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden">
      <style>{`
        .excalidraw .App-toolbar__extra-tools-trigger { display: none !important; }
        .excalidraw .ToolIcon__LaserPointer { display: none !important; }
        .excalidraw .default-sidebar-trigger { display: none !important; }
        .excalidraw .UserList__wrapper { display: none !important; }
        .excalidraw .zoom-actions { display: none !important; }
        .excalidraw .undo-redo-buttons { display: none !important; }
        .excalidraw .HelpButton { display: none !important; }
      `}</style>

      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        isCollaborating={true}
        theme={resolvedTheme as Theme}
        initialData={{
          elements: yElements ? yjsToExcalidraw(yElements) : [],
          appState: { viewBackgroundColor: "transparent" },
        }}
        onPointerUpdate={handlePointerUpdate}
        viewModeEnabled={viewModeEnabled}
        validateEmbeddable={false}
        aiEnabled={false}
        UIOptions={{
          tools: { image: false, eraser: false } as { image: boolean } & Record<string, boolean>,
          canvasActions: {
            changeViewBackgroundColor: false,
            loadScene: false,
            export: {
              saveFileToDisk: true,
            },
          },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
