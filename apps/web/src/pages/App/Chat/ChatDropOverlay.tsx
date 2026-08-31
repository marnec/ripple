import { Upload } from "lucide-react";

/**
 * Shown over the whole chat pane while files are dragged across it.
 *
 * `pointer-events-none` is load-bearing, not cosmetic: an overlay that took
 * pointer events would appear *under the cursor* the instant the drag entered,
 * firing a `dragleave` for the element the pointer just left and a `dragenter`
 * for the overlay — the enter/leave counter in `useFileDrop` would then chase
 * an element that only exists while the count is above zero.
 */
export function ChatDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-6 animate-fade-in">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary/60 px-10 py-8 text-center">
        <Upload className="h-8 w-8 text-primary" />
        <div>
          <p className="text-sm font-medium">Drop to attach</p>
          <p className="text-xs text-muted-foreground">
            Images are sent inline; anything else as a file
          </p>
        </div>
      </div>
    </div>
  );
}
