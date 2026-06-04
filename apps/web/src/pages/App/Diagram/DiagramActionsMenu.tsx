import { useState } from "react";
import { useTheme } from "next-themes";
import { FileImage, FileJson, FileText } from "lucide-react";
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
  const { resolvedTheme } = useTheme();

  const guarded = makeExportHandler(
    () => excalidrawAPI,
    toast.error,
    "Diagram is still loading.",
  );

  const downloadItems: readonly DownloadItem[] = [
    {
      // Opens Excalidraw's native export dialog (PNG / SVG / copy-to-clipboard,
      // with scale / background / dark-mode options) — the same dialog the
      // Ctrl+Shift+E shortcut and the hamburger's "Export image" item open.
      // Routing it through here lets the native menu stay hidden while keeping
      // the dialog's richer options. `updateScene` merges this into Excalidraw's
      // appState, which is what triggers the dialog to render.
      label: "image",
      icon: <FileImage className="text-muted-foreground" />,
      onSelect: guarded((api) => {
        // Seed the dialog's "Dark mode" switch from the app's resolved theme —
        // the switch initialises from appState.exportWithDarkMode, so set it as
        // we open the dialog. The user can still toggle it inside the dialog.
        api.updateScene({
          appState: {
            openDialog: { name: "imageExport" },
            exportWithDarkMode: resolvedTheme === "dark",
          },
        });
      }, "Failed to open image export."),
    },
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
