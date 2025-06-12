import { QueryParams } from "@shared/types/routes";
import { useParams } from "react-router-dom";
import { DiagramSelectorList } from "./DiagramSelectorList";

export function Diagrams() {
  const { workspaceId } = useParams<QueryParams>();

  if (!workspaceId) {
    return <div>Workspace not found</div>;
  }

  return (
    <div className="flex h-full w-full flex-col">
      The dev was lazy
    </div>
  );
} 