import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function useReferencedBlocks(documentId: Id<"documents">) {
  const blockIds = useQuery(api.documentBlockRefs.listReferencedBlockIds, {
    documentId,
  });

  const referencedBlockIds = new Set(blockIds ?? []);

  return {
    referencedBlockIds,
    hasReferencedBlocks: (blockIds?.length ?? 0) > 0,
  };
}
