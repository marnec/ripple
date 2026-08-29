import type { ClipboardEvent, DragEvent } from "react";
import { toast } from "sonner";

/**
 * Stops non-image files from being dropped or pasted into an editor.
 *
 * Removing `file`/`audio`/`video` from the schema (see `rich-text-schema.ts`)
 * takes them out of the slash menu, but not out of the drag/paste path:
 * BlockNote's file-drop handler picks a block type by matching the file's MIME
 * type against every spec's `fileBlockAccept`, and **defaults to `"file"`**
 * when nothing matches — a type the schema no longer has, so the insert throws
 * and the drop silently does nothing.
 *
 * The handlers are meant for the element *wrapping* the BlockNote view. They
 * run in the capture phase, so `stopPropagation` keeps the event from ever
 * reaching ProseMirror's own `handleDOMEvents` listeners on the editor node.
 * Image files are let through untouched.
 */
export function useMediaDropGuard(
  message = "Only images can be added here.",
): {
  onDropCapture: (event: DragEvent<HTMLElement>) => void;
  onPasteCapture: (event: ClipboardEvent<HTMLElement>) => void;
} {
  const block = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    toast.error(message);
  };

  return {
    onDropCapture: (event) => {
      if (hasNonImageFile(event.dataTransfer)) block(event);
    },
    onPasteCapture: (event) => {
      if (hasNonImageFile(event.clipboardData)) block(event);
    },
  };
}

function hasNonImageFile(data: DataTransfer | null): boolean {
  // `files` holds only real files — pasting styled text carries `items` of
  // kind "string", which must keep working.
  if (!data?.files?.length) return false;
  return Array.from(data.files).some((file) => !file.type.startsWith("image/"));
}
