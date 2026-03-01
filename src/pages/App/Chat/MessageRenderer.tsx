import { renderBlockGroups, type Block } from "@/components/BlockNoteRenderer";

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

  return (
    <>
      {imageUrl && (
        <button
          type="button"
          className="block cursor-pointer"
          onClick={() => onImageClick?.(imageUrl)}
        >
          <img
            src={imageUrl}
            alt=""
            className="max-w-xs sm:max-w-sm max-h-80 rounded-sm hover:brightness-90 transition-[filter]"
            loading="lazy"
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
