import { RippleSpinner } from "@/components/RippleSpinner";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { Id } from "../../../../convex/_generated/dataModel";
import { consumePendingImportFile } from "./diagram-import-state";

const createDiagramRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; name?: string },
  Id<"diagrams">
>("diagrams:create");

export function DiagramImport() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDiagram = useMutation(createDiagramRef);
  const [status, setStatus] = useState("Preparing import…");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !workspaceId) return;
    startedRef.current = true;

    const file = consumePendingImportFile();
    if (!file) {
      void navigate(`/workspaces/${workspaceId}/diagrams`, { replace: true });
      return;
    }

    void (async () => {
      try {
        setStatus("Reading file…");
        const { loadFromBlob } = await import("@excalidraw/excalidraw");

        setStatus("Parsing diagram…");
        const restored = await loadFromBlob(file, null, null);
        const elements = restored.elements ?? [];
        const files = restored.files ?? {};

        if (elements.length === 0) {
          toast.error("No diagram content could be extracted from this file.");
          void navigate(`/workspaces/${workspaceId}/diagrams`, { replace: true });
          return;
        }

        const diagramName =
          file.name.replace(/\.(excalidraw|png|svg)$/i, "") ||
          "Imported Diagram";

        setStatus("Creating diagram…");
        const diagramId = await createDiagram({
          workspaceId,
          name: diagramName,
        });

        void navigate(`/workspaces/${workspaceId}/diagrams/${diagramId}`, {
          replace: true,
          state: { importedScene: { elements, files } },
        });
      } catch (err) {
        console.error("Diagram import failed:", err);
        toast.error(
          "Failed to import diagram. Please try a different .excalidraw file.",
        );
        void navigate(`/workspaces/${workspaceId}/diagrams`, { replace: true });
      }
    })();
  }, [workspaceId, navigate, createDiagram]);

  return (
    <div className="h-full flex-1 min-w-0 flex flex-col relative">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <RippleSpinner size={64} />
          <p className="text-sm text-muted-foreground animate-pulse">
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}
