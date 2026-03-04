import { useRef, type RefObject } from "react";
import type { BlockNoteEditor, BlockIdentifier } from "@blocknote/core";

interface UseBlockResizeOptions {
  wrapperRef: RefObject<HTMLDivElement | null>;
  editor: BlockNoteEditor<any>;
  block: BlockIdentifier & { props: { textAlignment?: string; width?: number } };
}

export function useBlockResize({ wrapperRef, editor, block }: UseBlockResizeOptions) {
  const isResizingRef = useRef(false);

  const startResize = (e: React.MouseEvent, handle: "l" | "r") => {
    e.preventDefault();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const initialWidth = wrapper.clientWidth;
    const initialClientX = e.clientX;
    const alignment = block.props.textAlignment;

    const onMouseMove = (ev: MouseEvent) => {
      const xDiff = ev.clientX - initialClientX;
      const multiplier = alignment === "center" ? 2 : 1;
      const newWidth =
        handle === "r"
          ? initialWidth + xDiff * multiplier
          : initialWidth - xDiff * multiplier;

      const minWidth = 64;
      const editorWidth = (
        editor.domElement?.firstElementChild as HTMLElement
      )?.clientWidth;
      const finalWidth = Math.min(
        Math.max(newWidth, minWidth),
        editorWidth || Number.MAX_VALUE,
      );
      wrapper.style.width = `${finalWidth}px`;
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      isResizingRef.current = false;

      editor.updateBlock(block, {
        props: { width: wrapper.clientWidth },
      });
    };

    isResizingRef.current = true;
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
  };

  return { startResize, isResizingRef };
}
