import { useRef, useState, type DragEvent } from "react";

/**
 * Whether a drag is carrying real files, as opposed to text, a link, or one of
 * the page's own drags (a message image, a kanban card).
 *
 * `dataTransfer.files` is deliberately empty during `dragenter`/`dragover` —
 * the browser only exposes the bytes on `drop` — so `types` is the only thing
 * that can answer this while the drag is still in flight.
 */
function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
}

export interface FileDropProps {
  onDragEnterCapture: (event: DragEvent<HTMLElement>) => void;
  onDragOverCapture: (event: DragEvent<HTMLElement>) => void;
  onDragLeaveCapture: (event: DragEvent<HTMLElement>) => void;
  onDropCapture: (event: DragEvent<HTMLElement>) => void;
}

/**
 * Turn an element into a file drop target, with an `isDragging` flag to paint
 * an overlay from.
 *
 * Everything runs in the **capture** phase so the drop is claimed before it
 * reaches anything nested inside — ProseMirror installs its own drop listener
 * on the editor node, and a file that reaches it is either inserted as a block
 * the schema does not have or silently swallowed.
 *
 * A drag that is not carrying files is left completely alone: no
 * `preventDefault`, no `stopPropagation`, no overlay.
 */
export function useFileDrop(onDrop: (files: File[]) => void): {
  isDragging: boolean;
  dropProps: FileDropProps;
} {
  const [isDragging, setIsDragging] = useState(false);
  // `dragenter`/`dragleave` fire again for every element the pointer crosses,
  // so a plain boolean flickers off the moment the cursor moves from the
  // message list onto a message. Counting enters against leaves is the fix;
  // the overlay itself is `pointer-events-none` so it never joins the count.
  const depth = useRef(0);

  const stopDragging = () => {
    depth.current = 0;
    setIsDragging(false);
  };

  return {
    isDragging,
    dropProps: {
      onDragEnterCapture: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        depth.current += 1;
        setIsDragging(true);
      },
      onDragOverCapture: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        // Without this the browser treats the drop as a navigation and
        // replaces the app with the dropped file.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeaveCapture: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        depth.current -= 1;
        if (depth.current <= 0) stopDragging();
      },
      onDropCapture: (event) => {
        if (!carriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        stopDragging();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onDrop(files);
      },
    },
  };
}
