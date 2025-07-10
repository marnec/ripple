"use client";

import { Excalidraw, reconcileElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import {
  ExcalidrawElement,
  OrderedExcalidrawElement,
  Theme,
} from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";
import { Doc } from "../../../../convex/_generated/dataModel";

type DiagramPageProps = {
  onSave: (
    elements: readonly OrderedExcalidrawElement[],
    appState: Partial<AppState>,
  ) => Promise<null>;
  diagram: Doc<"diagrams">;
};

export function ExcalidrawEditor({ onSave, diagram }: DiagramPageProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();
  const { resolvedTheme } = useTheme();
  const isSaving = useRef(false);
  const elementsRef = useRef<readonly ExcalidrawElement[]>();

  useEffect(() => {
    if (!diagram.content) return;
    try {
      const scene = JSON.parse(diagram.content);
      elementsRef.current = scene.elements || [];
    } catch (e) {
      console.error("Failed to parse diagram content in useEffect", e);
    }
  }, [diagram.content]);

  useEffect(() => {
    if (!excalidrawAPI || !diagram.content) return;

    try {
      const remoteScene = JSON.parse(diagram.content);
      if (!remoteScene) return;

      const localElements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const remoteElements = remoteScene.elements as RemoteExcalidrawElement[];

      if (JSON.stringify(localElements) === JSON.stringify(remoteElements)) {
        return;
      }

      const reconciledElements = reconcileElements(
        localElements,
        remoteElements,
        excalidrawAPI.getAppState(),
      );
      excalidrawAPI.updateScene({ elements: reconciledElements });
    } catch (e) {
      console.error("Failed to parse or sync diagram content", e);
    }
  }, [diagram.content, excalidrawAPI]);

  const debouncedSave = useDebounceCallback(
    async (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
    ) => {
      if (isSaving.current) return;
      isSaving.current = true;
      elementsRef.current = elements;
      await onSave(elements, {
        viewBackgroundColor: appState.viewBackgroundColor,
        scrollX: appState.scrollX, 
        scrollY: appState.scrollY,
        editingFrame: appState.editingFrame
      });
      isSaving.current = false;
    },
    100,
  );

  return (
    <div className="relative h-full w-full">
      <div className="h-full">
        <Excalidraw
          excalidrawAPI={setExcalidrawAPI}
          theme={resolvedTheme as Theme}
          initialData={() => {
            if (!diagram.content) return { elements: [] };
            try {
              const scene = JSON.parse(diagram.content);
              elementsRef.current = scene.elements || [];
              return scene;
            } catch (e) {
              console.error("Failed to parse initial diagram content", e);
              return { elements: [] };
            }
          }}
          onChange={(elements, appState) => {
            if (
              JSON.stringify(elements) !== JSON.stringify(elementsRef.current)
            ) {
              if (isSaving.current) {
                return;
              }
              void debouncedSave(elements, appState);
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
    </div>
  );
}
