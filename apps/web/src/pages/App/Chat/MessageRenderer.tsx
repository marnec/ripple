import { PenTool } from "lucide-react";
import { renderBlockGroups, type Block } from "@/components/BlockNoteRenderer";

export type { Block };

interface ImageProps {
  url?: string;
  fullUrl?: string;
  /** Intrinsic size of the thumbnail, recorded at upload time. */
  width?: number;
  height?: number;
  /** Set when the image is a diagram snapshot — enables click-to-open. */
  diagramId?: string;
  diagramName?: string;
}

/** Tallest an inline chat image is allowed to render (matches `max-h-80`). */
const MAX_IMAGE_HEIGHT = 320;

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

  // With the intrinsic size known, the box is sized before the bytes arrive:
  // `aspect-ratio` + an explicit width reserve the exact final geometry, so the
  // wall lays out once instead of reflowing message-by-message as blobs land.
  // Capping the width at the height limit's equivalent keeps tall images from
  // being squashed by `max-h-80` (which would clamp height without width).
  const { width, height } = imageProps ?? {};
  const hasSize = !!width && !!height;
  const sizedStyle = hasSize
    ? {
        aspectRatio: `${width} / ${height}`,
        width: Math.min(width, Math.round((MAX_IMAGE_HEIGHT * width) / height)),
      }
    : undefined;

  return (
    <>
      {thumbnailUrl && (
        <div className="group relative block w-fit">
          <button
            type="button"
            aria-label="Open image"
            className="block cursor-pointer"
            onClick={() => onImageClick?.(thumbnailUrl, fullUrl!)}
          >
            <img
              src={thumbnailUrl}
              alt={imageProps?.diagramName ?? ""}
              width={width}
              height={height}
              style={sizedStyle}
              className={
                hasSize
                  ? "max-w-xs sm:max-w-sm h-auto bg-muted/40 hover:brightness-90 transition-[filter]"
                  : "max-w-xs sm:max-w-sm max-h-80 hover:brightness-90 transition-[filter]"
              }
              loading="lazy"
            />
          </button>
          {diagramId && (
            // pointer-events-none lets clicks fall through to the image button
            // below; only the name link re-enables them to open the diagram.
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-black/60 to-transparent px-2.5 pb-1.5 pt-6 text-xs font-medium text-white">
              <PenTool className="h-3.5 w-3.5 shrink-0" />
              <button
                type="button"
                className="pointer-events-auto truncate hover:underline"
                onClick={() => onDiagramOpen?.(diagramId)}
              >
                {imageProps?.diagramName || "Open diagram"}
              </button>
            </span>
          )}
        </div>
      )}
      {hasText && (
        <div className={thumbnailUrl ? "px-3 pb-2 pt-1.5" : undefined}>
          {renderBlockGroups(rest)}
        </div>
      )}
    </>
  );
}
