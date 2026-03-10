import { toast } from "sonner";
import { useEffect, useRef } from "react";

/** Minimal editor shape required by useEmbedDeleteProtection. */
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

const EMBED_TYPES = new Set(["diagram", "spreadsheetRange", "documentBlockEmbed"]);

const EMBED_LABELS: Record<string, string> = {
  diagram: "Diagram embed",
  spreadsheetRange: "Spreadsheet range",
  documentBlockEmbed: "Document embed",
};

const TOAST_DURATION = 5000;

/**
 * Intercepts deletion of embed blocks (diagram, spreadsheetRange, documentBlockEmbed).
 * Shows a destructive toast with undo action and a countdown progress bar.
 */
export function useEmbedDeleteProtection(editor: AnyEditor | null): void {
  const programmaticRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!editor || !editor.isEditable) return;

    const unsub = editor.onBeforeChange(({ getChanges }) => {
      const changes = getChanges();

      const embedDeletions = changes.filter((c) => {
        if (
          c.type !== "delete" ||
          !EMBED_TYPES.has(c.block.type) ||
          c.source.type !== "local" ||
          programmaticRef.current.has(c.block.id)
        )
          return false;

        // Skip protection for embeds showing a "deleted resource" placeholder
        const blockEl = editor.domElement?.querySelector(
          `[data-id="${c.block.id}"]`,
        );
        if (blockEl?.querySelector("[data-embed-deleted]")) return false;

        return true;
      });

      if (embedDeletions.length === 0) return; // allow change through

      for (const del of embedDeletions) {
        const blockId = del.block.id;

        // Capture block data for undo before removal
        const blockData = {
          type: del.block.type,
          props: { ...del.block.props },
          children: del.block.children,
        };

        // Programmatically remove after preventing the original deletion
        programmaticRef.current.add(blockId);
        try {
          editor.removeBlocks([blockId]);
        } finally {
          programmaticRef.current.delete(blockId);
        }

        const cursorBlock = editor.getTextCursorPosition().block;

        const label =
          embedDeletions.length === 1
            ? `${EMBED_LABELS[del.block.type] ?? "Embed"} removed`
            : `${embedDeletions.length} embeds removed`;

        toast.error(label, {
          duration: TOAST_DURATION,
          action: {
            label: "Undo",
            onClick: () => {
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

