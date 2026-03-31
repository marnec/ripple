import { RippleSpinner } from "@/components/RippleSpinner";
import type { QueryParams } from "@shared/types/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { Id } from "../../../../convex/_generated/dataModel";
import { consumePendingImportFile } from "./import-state";

const createDocumentRef = makeFunctionReference<
  "mutation",
  { workspaceId: Id<"workspaces">; name?: string },
  Id<"documents">
>("documents:create");

export function DocumentImport() {
  const { workspaceId } = useParams<QueryParams>();
  const navigate = useNavigate();
  const createDocument = useMutation(createDocumentRef);
  const [status, setStatus] = useState("Preparing import…");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !workspaceId) return;
    startedRef.current = true;

    const file = consumePendingImportFile();
    if (!file) {
      void navigate(`/workspaces/${workspaceId}/documents`, { replace: true });
      return;
    }

    void (async () => {
      try {
        // 1. Read file
        setStatus("Reading file…");
        const arrayBuffer = await file.arrayBuffer();

        // 2. Convert docx → HTML
        setStatus("Converting document…");
        const mammoth = await import("mammoth");
        const result = await mammoth.default.convertToHtml({ arrayBuffer });
        const html = result.value;

        if (!html || html.trim().length === 0) {
          toast.error("No content could be extracted from this file.");
          void navigate(`/workspaces/${workspaceId}/documents`, { replace: true });
          return;
        }

        // 3. Extract document name from filename
        const docName = file.name.replace(/\.docx?$/i, "") || "Imported Document";

        // 4. Create document in Convex
        setStatus("Creating document…");
        const documentId = await createDocument({ workspaceId, name: docName });

        // 5. Navigate to real editor with raw HTML for injection
        void navigate(`/workspaces/${workspaceId}/documents/${documentId}`, {
          replace: true,
          state: { importedHTML: html },
        });
      } catch (err) {
        console.error("Document import failed:", err);
        toast.error("Failed to import document. Please try a different file.");
        void navigate(`/workspaces/${workspaceId}/documents`, { replace: true });
      }
    })();
  }, [workspaceId, navigate, createDocument]);

  return (
    <div className="h-full flex-1 min-w-0 flex flex-col relative">
      {/* Blurred background mimicking a document page */}
      <div className="absolute inset-0 flex flex-col">
        <div className="border-b h-[49px]" />
        <div className="flex-1 flex justify-center pt-12">
          <div className="w-full max-w-2xl px-8 space-y-4 blur-sm opacity-30">
            <div className="h-8 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-5/6" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="h-6" />
            <div className="h-6 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-4 bg-muted rounded w-4/5" />
            <div className="h-4 bg-muted rounded w-full" />
          </div>
        </div>
      </div>
      {/* Foreground spinner + status */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="flex flex-col items-center gap-4">
          <RippleSpinner size={64} />
          <p className="text-sm text-muted-foreground animate-pulse">{status}</p>
        </div>
      </div>
    </div>
  );
}
