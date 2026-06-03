import { useState } from "react";
import { FileCode2, FileImage, FileJson, FileText } from "lucide-react";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ShareDialog } from "@/components/ShareDialog";
import { type DownloadItem, ResourceActionsMenu } from "@/components/ResourceActionsMenu";
import { makeExportHandler } from "@/lib/export-handler";
import type { Id } from "@convex/_generated/dataModel";

const loadExporters = () => import("@/lib/exporters/diagram");

interface DiagramActionsMenuProps {
  diagramId: Id<"diagrams">;
  diagramName: string;
  isAdmin: boolean;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

export function DiagramActionsMenu({
  diagramId,
  diagramName,
  isAdmin,
  excalidrawAPI,
}: DiagramActionsMenuProps) {
  const [shareOpen, setShareOpen] = useState(false);

  const guarded = makeExportHandler(
    () => excalidrawAPI,
    toast.error,
    "Diagram is still loading.",
  );

  const downloadItems: readonly DownloadItem[] = [
    {
      // One PDF page per frame (whole-diagram fallback when there are no frames).
      label: "PDF",
      icon: <FileText className="text-muted-foreground" />,
      onSelect: guarded(async (api) => {
        const m = await loadExporters();
        await m.exportDiagramPdf(api, diagramName);
      }, "Failed to export PDF."),
    },
    {
      label: "PNG",
      icon: <FileImage className="text-muted-foreground" />,
      onSelect: guarded(async (api) => {
        const m = await loadExporters();
        await m.exportDiagramPng(api, diagramName);
      }, "Failed to export PNG."),
    },
    {
      label: "SVG",
      icon: <FileCode2 className="text-muted-foreground" />,
      onSelect: guarded(async (api) => {
        const m = await loadExporters();
        await m.exportDiagramSvg(api, diagramName);
      }, "Failed to export SVG."),
    },
    {
      label: "Excalidraw",
      icon: <FileJson className="text-muted-foreground" />,
      onSelect: guarded(async (api) => {
        const m = await loadExporters();
        m.exportDiagramJson(api, diagramName);
      }, "Failed to export Excalidraw scene."),
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
          resourceType="diagram"
          resourceId={diagramId}
          resourceName={diagramName}
        />
      )}
    />
  );
}
