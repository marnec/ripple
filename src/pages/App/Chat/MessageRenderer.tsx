import { renderBlockGroups, type Block } from "@/components/BlockNoteRenderer";
import { useState } from "react";

export type { Block };

interface MessageRendererProps {
  blocks: Block[];
  onImageClick?: (url: string) => void;
}

/**
 * Telegram-style renderer: image renders full-bleed (no padding),
 * remaining blocks render below with normal padding.
 */
export function MessageRenderer({ blocks, onImageClick }: MessageRendererProps) {
  const imageBlock = blocks.find((b) => b.type === "image");
  const rest = blocks.filter((b) => b.type !== "image");
  const hasText = rest.some((b) => {
    if (b.type === "paragraph" && Array.isArray(b.content) && b.content.length > 0) return true;
    if (b.type !== "paragraph") return true;
    return false;
  });

  const imageUrl = (imageBlock?.props as { url?: string })?.url;
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <>
      {imageUrl && (
        <button
          type="button"
          className="block cursor-pointer"
          onClick={() => onImageClick?.(imageUrl)}
        >
          {!imageLoaded && (
            <div className="w-48 h-48 max-w-xs sm:max-w-sm rounded-sm bg-muted" />
          )}
          <img
            src={imageUrl}
            alt=""
            className={`max-w-xs sm:max-w-sm max-h-80 rounded-sm hover:brightness-90 transition-[filter] ${imageLoaded ? "animate-in fade-in duration-300" : "hidden"}`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
          />
        </button>
      )}
      {hasText && (
        <div className={imageUrl ? "px-3 pb-2 pt-1.5" : undefined}>
          {renderBlockGroups(rest)}
        </div>
      )}
    </>
  );
}
