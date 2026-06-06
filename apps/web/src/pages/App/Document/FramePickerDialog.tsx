import { useEffect, useMemo, useState } from "react";
import { exportToSvg } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from "@excalidraw/excalidraw/element/types";
import { useTheme } from "next-themes";
import { Frame as FrameIcon, LayoutGrid } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { useDiagramScene } from "@/hooks/use-diagram-scene";
import { frameViewElements, orderFrames } from "@/pages/App/Diagram/frames";
import type { Id } from "@convex/_generated/dataModel";

/** A clipped SVG preview of a single frame, generated client-side. */
function FrameThumbnail({
  elements,
  frame,
  isDark,
}: {
  elements: readonly ExcalidrawElement[];
  frame: ExcalidrawFrameLikeElement;
  isDark: boolean;
}) {
  const [svgHtml, setSvgHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Match the embed: natural bounds, no exportingFrame clip (see
        // frameViewElements), so the thumbnail previews exactly what embeds.
        const sel = frameViewElements(elements, frame.id);
        const svg = await exportToSvg({
          elements: sel.length > 0 ? sel : elements,
          appState: {
            exportWithDarkMode: isDark,
            exportBackground: false,
            frameRendering: { enabled: true, name: false, outline: false, clip: false },
          },
          files: null,
        });
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = "100%";
        svg.style.height = "100%";
        if (!cancelled) setSvgHtml(svg.outerHTML);
      } catch {
        if (!cancelled) setSvgHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [elements, frame, isDark]);

  return (
    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded border bg-background [&>div]:flex [&>div]:h-full [&>div]:w-full [&>div]:items-center [&>div]:justify-center [&_svg]:max-h-full [&_svg]:max-w-full">
      {svgHtml ? (
        <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
      ) : (
        <FrameIcon className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}

interface FramePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diagramId: Id<"diagrams">;
  diagramName: string;
  onInsert: (frameId: string | null) => void;
}

/**
 * Picks which part of a diagram to embed: a specific Excalidraw frame, or the
 * whole canvas. Mirrors the spreadsheet CellRefDialog / document
 * BlockPickerDialog "choose a sub-target after selecting a resource" pattern.
 * A diagram with no frames resolves to the whole-diagram embed automatically.
 */
export function FramePickerDialog({
  open,
  onOpenChange,
  diagramId,
  diagramName,
  onInsert,
}: FramePickerDialogProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { elements, isLoading } = useDiagramScene(diagramId, open);

  const frames = useMemo(
    () => orderFrames(elements) as unknown as ExcalidrawFrameLikeElement[],
    [elements],
  );

  const select = (frameId: string | null) => {
    onInsert(frameId);
    onOpenChange(false);
  };

  // No frames to choose from → embed the whole diagram and close immediately,
  // so frameless diagrams keep the original one-step embed flow.
  useEffect(() => {
    if (open && !isLoading && frames.length === 0) {
      select(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading, frames.length]);

  // Defer showing the dialog until the scene has loaded AND has frames worth
  // choosing between. While loading we keep the hook running (open → enabled)
  // but render nothing, so a frameless diagram resolves straight to the
  // whole-diagram embed via the effect above — no one-frame flash of the
  // dialog before it realises there's nothing to pick.
  const visible = open && !isLoading && frames.length > 0;

  return (
    <ResponsiveDialog open={visible} onOpenChange={onOpenChange} direction="top">
      <ResponsiveDialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <FrameIcon className="h-4 w-4" />
            <span className="truncate">Embed from {diagramName}</span>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Choose a frame to embed, or the whole diagram.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div className="space-y-1 py-2">
            <button
              type="button"
              onClick={() => select(null)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded border bg-background">
                <LayoutGrid className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">Whole diagram</p>
                <p className="text-xs text-muted-foreground">
                  Embed the entire canvas
                </p>
              </div>
            </button>
            {frames.map((frame, i) => (
              <button
                key={frame.id}
                type="button"
                onClick={() => select(frame.id)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <FrameThumbnail elements={elements} frame={frame} isDark={isDark} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {frame.name || `Frame ${i + 1}`}
                  </p>
                  <p className="text-xs text-muted-foreground">Frame</p>
                </div>
              </button>
            ))}
          </div>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
