import { useQuery } from "convex-helpers/react/cache";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export interface UseSpreadsheetCellPreviewResult {
  /** Extracted cell values, or null if not yet available. */
  values: string[][] | null;
  /** Still loading from all sources. */
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
 */
export function useSpreadsheetCellPreview(
  spreadsheetId: Id<"spreadsheets">,
  stableRef: string,
): UseSpreadsheetCellPreviewResult {
  const cellData = useQuery(
    api.spreadsheetCellRefs.getCellRef,
    stableRef ? { spreadsheetId, stableRef } : "skip",
  );

  return {
    values: cellData?.values ?? null,
    isLoading: cellData === undefined,
    orphan: cellData?.orphan === true,
    liveCellRef: cellData?.cellRef ?? null,
  };
}
