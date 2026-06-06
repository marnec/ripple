import { PenTool } from "lucide-react";
import { renderBlockGroups, type Block } from "@/components/BlockNoteRenderer";

export type { Block };

interface ImageProps {
  url?: string;
  fullUrl?: string;
  /** Set when the image is a diagram snapshot — enables click-to-open. */
  diagramId?: string;
  diagramName?: string;
}

interface MessageRendererProps {
  blocks: Block[];
  onImageClick?: (thumbnailUrl: string, fullUrl: string) => void;
  /** Called when a diagram-snapshot image is clicked (opens the live diagram). */
  onDiagramOpen?: (diagramId: string) => void;
}

/**
 * Telegram-style renderer: image renders full-bleed (no padding),
 * remaining blocks render below with normal padding.
 */
export function MessageRenderer({ blocks, onImageClick, onDiagramOpen }: MessageRendererProps) {
  const imageBlock = blocks.find((b) => b.type === "image");
  const rest = blocks.filter((b) => b.type !== "image");
  const hasText = rest.some((b) => {
    if (b.type === "paragraph" && Array.isArray(b.content) && b.content.length > 0) return true;
    if (b.type !== "paragraph") return true;
    return false;
  });

  const imageProps = imageBlock?.props as ImageProps | undefined;
  const thumbnailUrl = imageProps?.url;
  const fullUrl = imageProps?.fullUrl || thumbnailUrl;
  const diagramId = imageProps?.diagramId;

  return (
    <>
      {thumbnailUrl && (
        <button
          type="button"
          className="group relative block cursor-pointer"
          onClick={() =>
            diagramId ? onDiagramOpen?.(diagramId) : onImageClick?.(thumbnailUrl, fullUrl!)
          }
        >
          <img
            src={thumbnailUrl}
            alt={imageProps?.diagramName ?? ""}
            className="max-w-xs sm:max-w-sm max-h-80 hover:brightness-90 transition-[filter]"
            loading="lazy"
          />
          {diagramId && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/60 to-transparent px-2.5 pb-1.5 pt-6 text-xs font-medium text-white">
              <PenTool className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{imageProps?.diagramName || "Open diagram"}</span>
            </span>
          )}
        </button>
      )}
      {hasText && (
        <div className={thumbnailUrl ? "px-3 pb-2 pt-1.5" : undefined}>
          {renderBlockGroups(rest)}
        </div>
      )}
    </>
  );
}
