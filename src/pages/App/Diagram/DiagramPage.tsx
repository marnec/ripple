import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCallback } from "react";
import { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AppState } from "@excalidraw/excalidraw/types";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";

function DiagramPageContent({ diagramId }: { diagramId: Id<"diagrams"> }) {
  const diagram = useQuery(api.diagrams.get, { id: diagramId });
  const viewer = useQuery(api.users.viewer);
  const presenceState = usePresence(
    api.presence,
    diagramId,
    viewer?.name ?? "Anonymous",
  );
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
      <div className="absolute top-2 right-10 z-50">
        <FacePile presenceState={presenceState ?? []} />
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
