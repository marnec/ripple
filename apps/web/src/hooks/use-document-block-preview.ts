import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { blockPreviewKey, type BlockRefPreview } from "@/lib/embed-preview-cache";
import { useEmbedPreview } from "./use-embed-preview";


/**
 * Hook for the quoted text of a document block embed.
 *
 * Same shape as `useSpreadsheetCellPreview`: the device's copy of the last
 * projection paints immediately, the server's answer replaces it, and the
 * insert path seeds the copy with the text the block picker was showing so a
 * new embed never renders empty.
 */
export function useDocumentBlockPreview(
  documentId: Id<"documents"> | string,
  blockId: string,
) {
  const live = useQuery(
    api.documentBlockRefs.getBlockRef,
    documentId && blockId
      ? { documentId: documentId as Id<"documents">, blockId }
      : "skip",
  );

  const { value } = useEmbedPreview<BlockRefPreview>(
    documentId && blockId ? blockPreviewKey(documentId, blockId) : null,
    live,
  );

  return {
    blockType: value?.blockType ?? null,
    textContent: value?.textContent ?? null,
    isLoading: value === undefined,
  };
}
