import { CountdownBar } from "@/components/CountdownBar";
import { ToastAction, type ToastActionElement } from "@/components/ui/toast";
import { toast } from "@/components/ui/use-toast";
import { useEffect, useRef } from "react";
import React from "react";

/** Minimal editor shape needed by this hook. */
type AnyEditor = {
  isEditable: boolean;
  document: unknown[];
  domElement: HTMLElement | null | undefined;
  onBeforeChange: (
    callback: (context: {
      getChanges: () => Array<{
        block: { id: string; type: string; props: Record<string, unknown>; children?: unknown[] };
        source: { type: string };
        type: string;
        prevBlock: unknown;
      }>;
    }) => boolean | void,
  ) => () => void;
  removeBlocks: (blocks: Array<{ id: string } | string>) => any;
  insertBlocks: (...args: any[]) => any;
  getTextCursorPosition: () => { block: { id: string } };
};

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
  const referencedRef = useRef(referencedBlockIds);
  referencedRef.current = referencedBlockIds;
  const onBlocksDeletedRef = useRef(onBlocksDeleted);
  onBlocksDeletedRef.current = onBlocksDeleted;

  useEffect(() => {
    if (!editor || !editor.isEditable) return;

    const unsub = editor.onBeforeChange(({ getChanges }) => {
      const changes = getChanges();

      const refDeletions = changes.filter(
        (c) =>
          c.type === "delete" &&
          c.source.type === "local" &&
          referencedRef.current.has(c.block.id) &&
          !programmaticRef.current.has(c.block.id),
      );

      if (refDeletions.length === 0) return; // allow change through

      for (const del of refDeletions) {
        const blockId = del.block.id;

        // Capture block data for undo
        const blockData = {
          type: del.block.type,
          props: { ...del.block.props },
          children: del.block.children,
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
          onBlocksDeletedRef.current?.([blockId]);
        }, TOAST_DURATION + 200);

        toast({
          variant: "destructive",
          title: "Referenced block removed",
          description: React.createElement(CountdownBar, { duration: TOAST_DURATION }),
          duration: TOAST_DURATION,
          action: React.createElement(
            ToastAction,
            {
              altText: "Undo",
              onClick: () => {
                clearTimeout(cleanupTimer);
                editor.insertBlocks([blockData], cursorBlock, "before");
              },
            },
            "Undo",
          ) as unknown as ToastActionElement,
        });
      }

      return false; // prevent the original deletion
    });

    return unsub;
  }, [editor]);
}
