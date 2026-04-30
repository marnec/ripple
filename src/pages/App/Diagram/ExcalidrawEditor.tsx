"use client";

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { Theme } from "@excalidraw/excalidraw/element/types";
import { generateNKeysBetween } from "fractional-indexing";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { ExcalidrawBinding, yjsToExcalidraw } from "y-excalidraw";
import type { Awareness } from "y-protocols/awareness";
import type YProvider from "y-partyserver/provider";
import * as Y from "yjs";


interface ImportedScene {
  elements: readonly unknown[];
  files: Record<string, unknown>;
}

interface ExcalidrawEditorProps {
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness | null;
  provider: YProvider | null;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  viewModeEnabled?: boolean;
  importedScene?: ImportedScene | null;
}

export function ExcalidrawEditor({
  yElements,
  yAssets,
  awareness,
  provider,
  onExcalidrawAPI,
  viewModeEnabled,
  importedScene,
}: ExcalidrawEditorProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const { resolvedTheme } = useTheme();
  const bindingRef = useRef<ExcalidrawBinding | null>(null);

  // Seed an imported .excalidraw upload synchronously during first render,
  // BEFORE Excalidraw mounts. Excalidraw's internal initializeScene runs more
  // than once and resets the scene from initialData each time
  // (excalidraw/excalidraw#7585), so anything injected via updateScene after
  // mount gets wiped. Putting elements into yElements before render means
  // initialData={ elements: yjsToExcalidraw(yElements) } already contains the
  // imported scene, and every initializeScene re-run lands on it.
  // useState's lazy initializer is the standard one-shot pre-render hook.
  useState(() => {
    if (
      !importedScene ||
      yElements.length !== 0 ||
      importedScene.elements.length === 0
    ) {
      return null;
    }
    const positions = generateNKeysBetween(
      null,
      null,
      importedScene.elements.length,
    );
    const doc = yElements.doc;
    const seed = () => {
      importedScene.elements.forEach((el, i) => {
        yElements.push([
          new Y.Map<unknown>(
            Object.entries({ pos: positions[i], el }),
          ) as Y.Map<any>,
        ]);
      });
      for (const [fileId, file] of Object.entries(importedScene.files)) {
        yAssets.set(fileId, file);
      }
    };
    if (doc) doc.transact(seed);
    else seed();
    window.history.replaceState({}, "");
    return null;
  });

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

  // Fit the diagram into view once on open. yElements may be empty at mount
  // if the user is opening a diagram cold (no IndexedDB cache) — in that case
  // wait for the first provider-sync update.
  const fittedOnOpenRef = useRef(false);
  useEffect(() => {
    if (!excalidrawAPI || fittedOnOpenRef.current) return;

    const fit = () => {
      if (fittedOnOpenRef.current || yElements.length === 0) return;
      fittedOnOpenRef.current = true;
      requestAnimationFrame(() => {
        excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
      });
    };

    fit();
    if (fittedOnOpenRef.current) return;

    const observer = () => fit();
    yElements.observe(observer);
    return () => yElements.unobserve(observer);
  }, [excalidrawAPI, yElements]);

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
          <MainMenu.DefaultItems.SaveToActiveFile />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
