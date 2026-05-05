import { useState } from "react";
import { FileCode2, FileImage, FileJson, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ShareDialog } from "@/components/ShareDialog";
import {
  ResponsiveDropdownMenu,
  ResponsiveDropdownMenuContent,
  ResponsiveDropdownMenuItem,
  ResponsiveDropdownMenuSeparator,
  ResponsiveDropdownMenuTrigger,
} from "@/components/ui/responsive-dropdown-menu";
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

  const guard = (fn: (api: ExcalidrawImperativeAPI) => Promise<void> | void, errorMsg: string) => () => {
    if (!excalidrawAPI) {
      toast.error("Diagram is still loading.");
      return;
    }
    void (async () => {
      try {
        await fn(excalidrawAPI);
      } catch (err) {
        console.error(err);
        toast.error(errorMsg);
      }
    })();
  };

  return (
    <>
      <ResponsiveDropdownMenu>
        <ResponsiveDropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Share & download"
            >
              <Share2 className="size-4" />
            </button>
          }
        />
        <ResponsiveDropdownMenuContent align="end" className="w-52 rounded-lg">
          {isAdmin && (
            <>
              <ResponsiveDropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="text-muted-foreground" />
                <span>Share…</span>
              </ResponsiveDropdownMenuItem>
              <ResponsiveDropdownMenuSeparator />
            </>
          )}
          <ResponsiveDropdownMenuItem
            onSelect={guard(async (api) => {
              const m = await loadExporters();
              await m.exportDiagramPng(api, diagramName);
            }, "Failed to export PNG.")}
          >
            <FileImage className="text-muted-foreground" />
            <span>Download as PNG</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem
            onSelect={guard(async (api) => {
              const m = await loadExporters();
              await m.exportDiagramSvg(api, diagramName);
            }, "Failed to export SVG.")}
          >
            <FileCode2 className="text-muted-foreground" />
            <span>Download as SVG</span>
          </ResponsiveDropdownMenuItem>
          <ResponsiveDropdownMenuItem
            onSelect={guard(async (api) => {
              const m = await loadExporters();
              m.exportDiagramJson(api, diagramName);
            }, "Failed to export Excalidraw scene.")}
          >
            <FileJson className="text-muted-foreground" />
            <span>Download as Excalidraw</span>
          </ResponsiveDropdownMenuItem>
        </ResponsiveDropdownMenuContent>
      </ResponsiveDropdownMenu>
      {isAdmin && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceType="diagram"
          resourceId={diagramId}
          resourceName={diagramName}
        />
      )}
    </>
  );
}
