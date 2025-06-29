import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCallback } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AppState } from "@excalidraw/excalidraw/types";

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: Id<"diagrams"> }>();
  const diagram = useQuery(api.diagrams.get, diagramId ? { id: diagramId } : "skip");
  const updateDiagramContent = useMutation(api.diagrams.updateContent);

  const onSave = useCallback(
    async (
      elements: readonly OrderedExcalidrawElement[],
      appState: Partial<AppState>,
    ) => {
      if (!diagramId) return null;
      console.log("Saving")
      await updateDiagramContent({
        id: diagramId,
        content: JSON.stringify({
          elements,
          appState,
        }),
      });
      return null;
    },
    [diagramId, updateDiagramContent],
  );

  return diagram && <ExcalidrawEditor onSave={onSave} diagram={diagram} />;
}
