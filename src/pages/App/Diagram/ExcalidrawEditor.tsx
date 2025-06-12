"use client";

import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useTheme } from "next-themes";
import { Reducer, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";

import { OrderedExcalidrawElement, Theme } from "@excalidraw/excalidraw/element/types";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

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

type DiagramPageProps = { diagramId: Id<"diagrams">; diagram: Doc<"diagrams"> };

export function ExcalidrawEditor({ diagramId, diagram }: DiagramPageProps) {
  const { resolvedTheme } = useTheme();

  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [state, dispatch] = useReducer(diagramStateMachine, "Initial");

  const updateDiagramContent = useMutation(api.diagrams.updateContent);

  const initializeRef = useRef(false);

  const savingIndicatorRef = useRef<HTMLDivElement>(null);
  const previousElementsRef = useRef<string>("");

  // Save function
  const saveDiagram = useCallback(
    async (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState
    ) => {
      console.log(state, elements)
      if (!diagramId) return
      if (state !== "Ready") return;

      dispatch("Save");

      // Check if elements have actually changed
      const currentElementsString = JSON.stringify(elements);
      console.log(currentElementsString === previousElementsRef.current);
      if (currentElementsString === previousElementsRef.current) {
        return;
      }

      // Update the reference to the current elements
      previousElementsRef.current = currentElementsString;

      try {
        // Show saving indicator without triggering re-render
        if (savingIndicatorRef.current) {
          savingIndicatorRef.current.style.display = "block";
        }

        await updateDiagramContent({
          id: diagramId,
          content: JSON.stringify({ elements, appState }),
        });
      } catch (error) {
        console.error("Failed to save diagram:", error);
      } finally {
        dispatch("OperationComplete")
        if (savingIndicatorRef.current) {
          savingIndicatorRef.current.style.display = "none";
        }
      }
    },
    [diagramId],
  );

  // Debounced save function using usehooks-ts
  const debouncedSave = useDebounceCallback(saveDiagram, 200);

  // Parse diagram content for initial data
  const getInitialData = () => {
    if (!diagram.content) {
      return {
        elements: [],
        appState: {
          viewBackgroundColor: "#ffffff",
        },
      };
    }

    try {
      const parsedContent = JSON.parse(diagram.content);

      return {
        elements: parsedContent.elements || [],
        appState: {
          viewBackgroundColor: "#ffffff",
          ...parsedContent.appState,
          collaborators: [],
        },
      };
    } catch (error) {
      console.error("Failed to parse diagram content:", error);
      return {
        elements: [],
        appState: {
          viewBackgroundColor: "#ffffff",
        },
      };
    }
  };

  const getInitialDatas = useCallback(getInitialData, []);

  useEffect(() => {
    if (!excalidrawAPI || initializeRef.current) return;

    initializeRef.current = true;

    // Initialize the previous elements ref with the loaded content

    if (diagram?.content) {
      try {
        const parsedContent = JSON.parse(diagram.content);
        previousElementsRef.current = JSON.stringify(parsedContent.elements || []);
      } catch (error) {
        console.error("Failed to initialize previous elements ref:", error);
      }
    }

    // Mark initial load as complete after a short delay to ensure Excalidraw has rendered
    setTimeout(() => {
      dispatch("LoadInitialData")
      console.log("Initial load complete - saving enabled");
    }, 1000);
  }, [excalidrawAPI, diagram]);

  useEffect(() => {
    if (!excalidrawAPI || !initializeRef.current) return;

    if (!diagram.content) return;

    try {
      const parsedContent = JSON.parse(diagram.content);
      // previousElementsRef.current = parsedContent.elements;
      excalidrawAPI?.updateScene({ elements: parsedContent.elements });
    } catch (error) {
      console.error("Failed to initialize previous elements ref:", error);
    }
  }, [diagram]);

  return (
    <div className="h-full w-full relative">
      <div
        ref={savingIndicatorRef}
        className="absolute top-4 right-4 z-[9999] text-white p-2 rounded-md shadow-lg flex items-center gap-2"
        style={{ display: "none" }}
      >
        <span className="text-sm">Saving...</span>
      </div>

      <div className="h-full">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          theme={resolvedTheme as Theme}
          initialData={getInitialDatas}
          onChange={(elements, appState) => {
            debouncedSave(elements, appState);
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
