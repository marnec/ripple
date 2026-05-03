import { toast } from "sonner";
import { useEffect, useEffectEvent, useRef } from "react";
import type { AnyEditor } from "./editor-types";

const TOAST_DURATION = 5000;

/**
 * Intercepts deletion of blocks that are referenced by documentBlockEmbeds in other documents.
 * Shows a destructive toast with undo action and a countdown progress bar.
 * After the undo window expires, calls `onBlocksDeleted` so the caller can clean up documentBlockRefs.
 */
export function useReferencedBlockDeleteProtection(
  editor: AnyEditor | null,
  referencedBlockIds: Set<string>,
  onBlocksDeleted?: (blockIds: string[]) => void,
): void {
  const programmaticRef = useRef<Set<string>>(new Set());
  const isReferenced = useEffectEvent((id: string) =>
    referencedBlockIds.has(id),
  );
  const handleBlocksDeleted = useEffectEvent((ids: string[]) => {
    onBlocksDeleted?.(ids);
  });

  useEffect(() => {
    if (!editor || !editor.isEditable) return;

    const unsub = editor.onBeforeChange(({ getChanges }) => {
      const changes = getChanges();

      const refDeletions = changes.filter(
        (c) =>
          c.type === "delete" &&
          c.source.type === "local" &&
          isReferenced(c.block.id) &&
          !programmaticRef.current.has(c.block.id),
      );

      if (refDeletions.length === 0) return; // allow change through

      for (const del of refDeletions) {
        const blockId = del.block.id;

        // Capture block data for undo. Preserve `id` so other docs'
        // documentBlockEmbeds still resolve after restore. Deep-clone
        // `content` and `children` because BlockNote/ProseMirror can
        // empty live references once the underlying node is removed.
        const blockData = {
          id: blockId,
          type: del.block.type,
          props: { ...del.block.props },
          content: del.block.content
            ? (JSON.parse(JSON.stringify(del.block.content)) as unknown)
            : undefined,
          children: del.block.children
            ? (JSON.parse(JSON.stringify(del.block.children)) as unknown[])
            : undefined,
        };

        // Programmatically remove (bypasses this hook on re-entry)
        programmaticRef.current.add(blockId);
        try {
          editor.removeBlocks([blockId]);
        } finally {
          programmaticRef.current.delete(blockId);
        }

        const cursorBlock = editor.getTextCursorPosition().block;

        // Schedule cleanup after undo window expires
        const cleanupTimer = setTimeout(() => {
          handleBlocksDeleted([blockId]);
        }, TOAST_DURATION + 200);

        toast.error("Referenced block removed", {
          duration: TOAST_DURATION,
          action: {
            label: "Undo",
            onClick: () => {
              clearTimeout(cleanupTimer);
              editor.insertBlocks([blockData], cursorBlock, "before");
            },
          },
        });
      }

      return false; // prevent the original deletion
    });

    return unsub;
  }, [editor]);
}
