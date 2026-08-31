import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cellPreviewKey, type CellPreview } from "@/lib/embed-preview-cache";
import { useEmbedPreview } from "./use-embed-preview";


export interface UseSpreadsheetCellPreviewResult {
  /** Extracted cell values, or null if not yet available. */
  values: string[][] | null;
  /** Nothing to show yet — neither this device nor the server has an answer. */
  isLoading: boolean;
  /** True when the underlying stableRef no longer resolves (row/col deleted). */
  orphan: boolean;
  /** Live A1 of the logical cell, derived from stableRef on every server push. */
  liveCellRef: string | null;
}

/**
 * Hook for spreadsheet cell values in document embeds.
 *
 * Resolution always goes through the stable identity of the cell — the
 * caller must supply a non-empty `stableRef` produced by
 * `prepareStableRef` at block-creation time.
 *
 * The device's own copy of the last projection is shown until the server
 * answers, so an embed paints with the document rather than a round trip
 * later. It is also what a just-inserted embed renders from: the insert path
 * seeds the cache with the values the picker was showing, which arrive before
 * the cache row itself exists.
 */
export function useSpreadsheetCellPreview(
  spreadsheetId: Id<"spreadsheets">,
  stableRef: string,
): UseSpreadsheetCellPreviewResult {
  const live = useQuery(
    api.spreadsheetCellRefs.getCellRef,
    stableRef ? { spreadsheetId, stableRef } : "skip",
  );

  const { value } = useEmbedPreview<CellPreview>(
    stableRef ? cellPreviewKey(spreadsheetId, stableRef) : null,
    live,
  );

  return {
    values: value?.values ?? null,
    isLoading: value === undefined,
    orphan: value?.orphan === true,
    liveCellRef: value?.cellRef ?? null,
  };
}
