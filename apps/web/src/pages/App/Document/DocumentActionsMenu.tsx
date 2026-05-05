import { useState } from "react";
import { Code2, FileText, FileType2 } from "lucide-react";
import { toast } from "sonner";
import type { BlockNoteEditor } from "@blocknote/core";
import { useConvex } from "convex/react";
import { ShareDialog } from "@/components/ShareDialog";
import { type DownloadItem, ResourceActionsMenu } from "@/components/ResourceActionsMenu";
import { makeExportHandler } from "@/lib/export-handler";
import type { Id } from "@convex/_generated/dataModel";

type DocumentExporters = typeof import("@/lib/exporters/document");
const loadExporters = (): Promise<DocumentExporters> => import("@/lib/exporters/document");

interface DocumentActionsMenuProps {
  documentId: Id<"documents">;
  documentName: string;
  isAdmin: boolean;
  editor: BlockNoteEditor<any, any, any> | null;
}

export function DocumentActionsMenu({
  documentId,
  documentName,
  isAdmin,
  editor,
}: DocumentActionsMenuProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const convex = useConvex();

  const guarded = makeExportHandler(
    () => editor,
    toast.error,
    "Document is still loading.",
  );

  const downloadItems: readonly DownloadItem[] = [
    {
      label: "Markdown",
      icon: <FileText className="text-muted-foreground" />,
      onSelect: guarded(async (e) => {
        const m = await loadExporters();
        const ctx = await m.buildExportContext(convex, e, { isDark: false });
        m.exportDocumentMarkdown(e, documentName, ctx);
      }, "Failed to export Markdown."),
    },
    {
      label: "HTML",
      icon: <Code2 className="text-muted-foreground" />,
      onSelect: guarded(async (e) => {
        const m = await loadExporters();
        const ctx = await m.buildExportContext(convex, e, { isDark: false });
        m.exportDocumentHTML(e, documentName, ctx);
      }, "Failed to export HTML."),
    },
    {
      label: "DOCX",
      icon: <FileType2 className="text-muted-foreground" />,
      onSelect: guarded(async (e) => {
        const m = await loadExporters();
        const ctx = await m.buildExportContext(convex, e, { isDark: false });
        await m.exportDocumentDocx(e, documentName, ctx);
      }, "Failed to export DOCX."),
    },
  ];

  return (
    <ResourceActionsMenu
      downloadItems={downloadItems}
      onShare={isAdmin ? () => setShareOpen(true) : undefined}
      shareDialog={isAdmin && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="document"
          resourceId={documentId}
          resourceName={documentName}
        />
      )}
    />
  );
}
