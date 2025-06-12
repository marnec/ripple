import { useParams } from "react-router-dom";
import { Id } from "../../../../convex/_generated/dataModel";
import { ExcalidrawEditor } from "./ExcalidrawEditor";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

export function DiagramPage() {
  const { diagramId } = useParams<{ diagramId: Id<"diagrams"> }>();
  const diagram = useQuery(api.diagrams.get, diagramId ? { id: diagramId } : "skip");

  return diagramId && diagram && <ExcalidrawEditor diagramId={diagramId} diagram={diagram} />;
}
