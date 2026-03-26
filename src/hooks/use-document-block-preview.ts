import { useQuery } from "convex-helpers/react/cache";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function useDocumentBlockPreview(
  documentId: Id<"documents"> | string,
  blockId: string,
) {
  const blockRef = useQuery(
    api.documentBlockRefs.getBlockRef,
    documentId && blockId
      ? { documentId: documentId as Id<"documents">, blockId }
      : "skip",
  );

  return {
    blockType: blockRef?.blockType ?? null,
    textContent: blockRef?.textContent ?? null,
    isLoading: blockRef === undefined,
  };
}
