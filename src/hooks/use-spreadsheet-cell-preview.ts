import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export interface UseSpreadsheetCellPreviewResult {
  /** Extracted cell values, or null if not yet available */
  values: string[][] | null;
  /** Still loading from all sources */
  isLoading: boolean;
}

/**
 * Hook for spreadsheet cell values in document embeds.
 *
 * Uses the Convex `spreadsheetCellRefs` table as the sole data source.
 * The spreadsheet DO pushes cell values to Convex every ~2 seconds during
 * active editing, so this reactive query provides near-real-time updates
 * without requiring a separate WebSocket connection.
 */
export function useSpreadsheetCellPreview(
  spreadsheetId: Id<"spreadsheets">,
  cellRef: string,
): UseSpreadsheetCellPreviewResult {
  const cellData = useQuery(api.spreadsheetCellRefs.getCellRef, {
    spreadsheetId,
    cellRef,
  });

  return {
    values: cellData?.values ?? null,
    isLoading: cellData === undefined,
  };
}
