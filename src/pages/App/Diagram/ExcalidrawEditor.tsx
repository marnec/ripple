"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { Reducer, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";

import { OrderedExcalidrawElement, Theme } from "@excalidraw/excalidraw/element/types";
import { Doc } from "../../../../convex/_generated/dataModel";

type DiagramState = "Initial" | "Ready" | "Saving" | "Syncing";

type DiagramEvent = "LoadInitialData" | "Save" | "Sync" | "OperationComplete";

const diagramStateMachine: Reducer<DiagramState, DiagramEvent> = (state, event) => {
  switch (state) {
    case "Initial":
      if (event === "LoadInitialData") return "Ready";
      break;
    case "Ready":
      if (event === "Save") return "Saving";
      if (event === "Sync") return "Syncing";
      break;
    case "Saving":
    case "Syncing":
      if (event === "OperationComplete") return "Ready";
      break;
  }

  return state;
};

type DiagramPageProps = {
  onSave: (elements: readonly OrderedExcalidrawElement[]) => Promise<null>;
  diagram: Doc<"diagrams">;
};

export function ExcalidrawEditor({ onSave, diagram }: DiagramPageProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI>();

  const { resolvedTheme } = useTheme();

  const [state, dispatch] = useReducer(diagramStateMachine, "Initial");

  const previousContent = useRef<string>(diagram?.content || "");

  useEffect(() => {
    if (!excalidrawAPI) return;
    if (state !== "Ready") return;

    dispatch("Sync");
    excalidrawAPI.updateScene({ elements: JSON.parse(diagram?.content || "null") || [] });
    dispatch("OperationComplete");
  }, [diagram, excalidrawAPI]);

  const debouncedSave = useDebounceCallback(async (elements) => {
    dispatch("Save");
    await onSave(elements);
    dispatch("OperationComplete");
  }, 200);

  return (
    <div className="h-full w-full relative">
      {state === "Saving" && (
        <div className="absolute top-4 right-4 z-[9999] text-white p-2 rounded-md shadow-lg flex items-center gap-2">
          <span className="text-sm">Saving...</span>
        </div>
      )}
      <div className="h-full">
        <Excalidraw
          excalidrawAPI={setExcalidrawAPI}
          theme={resolvedTheme as Theme}
          initialData={() => {
            dispatch("LoadInitialData");
            const data = { elements: JSON.parse(diagram.content || "null") || [] };
            return data;
          }}
          onChange={(elements) => {
            if (JSON.stringify(elements) === previousContent.current) return;

            previousContent.current = JSON.stringify(elements);

            if (state !== "Ready") return;

            debouncedSave(elements);
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
