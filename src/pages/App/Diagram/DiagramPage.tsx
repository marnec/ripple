import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCallback } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AppState } from "@excalidraw/excalidraw/types";
import { useEnhancedPresence } from "../../../hooks/use-enhanced-presence";
import { FacePile } from "../../../components/ui/facepile";

function DiagramPageContent({ diagramId }: { diagramId: Id<"diagrams"> }) {
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const enhancedPresence = useEnhancedPresence(diagramId);
  const updateDiagramContent = useMutation(api.diagrams.updateContent);

  const onSave = useCallback(
    async (
      elements: readonly OrderedExcalidrawElement[],
      appState: Partial<AppState>,
    ) => {
      console.log("Saving");
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

  return (
    <div className="relative h-full w-full">
      {diagram && <ExcalidrawEditor onSave={onSave} diagram={diagram} />}
      <div className="absolute top-5 right-10 z-50">
        <FacePile users={enhancedPresence} hideInactive={true} />
      </div>
    </div>
  );
}

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: Id<"diagrams"> }>();
  if (!diagramId) {
    return null;
  }
  return <DiagramPageContent diagramId={diagramId} />;
}
