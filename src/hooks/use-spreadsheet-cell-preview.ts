import { useState, useEffect, useRef } from "react";
import { useQuery, useAction, useConvexAuth } from "convex/react";
import { IndexeddbPersistence } from "y-indexeddb";
import YPartyKitProvider from "y-partykit/provider";
import * as Y from "yjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  normalizeCellRef,
  parseCellName,
  parseRange,
  isSingleCell,
} from "@shared/cellRef";

// Debounce interval for re-extracting cell values on Yjs updates
const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Shared Y.Doc manager — multiple cell refs to the same spreadsheet share
// a single Y.Doc + IndexedDB persistence + PartyKit provider.
// ---------------------------------------------------------------------------

interface SharedDoc {
  yDoc: Y.Doc;
  persistence: IndexeddbPersistence;
  provider: YPartyKitProvider | null;
  refCount: number;
  /** Set to true once IndexedDB has synced */
  indexedDbSynced: boolean;
  /** Callbacks to notify subscribers on sync/update */
  listeners: Set<() => void>;
}

const sharedDocs = new Map<string, SharedDoc>();

function acquireSharedDoc(spreadsheetId: string): SharedDoc {
  const existing = sharedDocs.get(spreadsheetId);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const yDoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(
    `spreadsheet-${spreadsheetId}`,
    yDoc,
  );

  const shared: SharedDoc = {
    yDoc,
    persistence,
    provider: null,
    refCount: 1,
    indexedDbSynced: false,
    listeners: new Set(),
  };

  persistence.on("synced", () => {
    shared.indexedDbSynced = true;
    for (const cb of shared.listeners) cb();
  });

  sharedDocs.set(spreadsheetId, shared);
  return shared;
}

function releaseSharedDoc(spreadsheetId: string) {
  const shared = sharedDocs.get(spreadsheetId);
  if (!shared) return;
  shared.refCount--;
  if (shared.refCount <= 0) {
    if (shared.provider) {
      shared.provider.shouldConnect = false;
      shared.provider.destroy();
    }
    void shared.persistence.destroy();
    shared.yDoc.destroy();
    sharedDocs.delete(spreadsheetId);
  }
}

// ---------------------------------------------------------------------------
// Cell value extraction (ported from convex/spreadsheetCellRefsNode.ts)
// ---------------------------------------------------------------------------

function resolveDisplayValue(
  rawValue: string,
  row: number,
  col: number,
  yFormulaValues?: Y.Map<string>,
): string {
  if (rawValue.startsWith("=") && yFormulaValues) {
    const computed = yFormulaValues.get(`${row},${col}`);
    if (computed !== undefined) return computed;
  }
  return rawValue;
}

function extractCellValues(
  yData: Y.Array<Y.Map<string>>,
  cellRef: string,
  yFormulaValues?: Y.Map<string>,
): string[][] | null {
  if (yData.length === 0) return null;

  const normalized = normalizeCellRef(cellRef);

  if (!isSingleCell(normalized)) {
    const range = parseRange(normalized);
    if (!range) return null;
    const result: string[][] = [];
    for (let r = range.startRow; r <= range.endRow && r < yData.length; r++) {
      const row: string[] = [];
      const rowMap = yData.get(r);
      for (let c = range.startCol; c <= range.endCol; c++) {
        const raw = rowMap?.get(String(c)) ?? "";
        row.push(resolveDisplayValue(raw, r, c, yFormulaValues));
      }
      result.push(row);
    }
    return result;
  } else {
    const cell = parseCellName(normalized);
    if (!cell) return null;
    if (cell.row >= yData.length) return [[""]];
    const rowMap = yData.get(cell.row);
    const raw = rowMap?.get(String(cell.col)) ?? "";
    return [[resolveDisplayValue(raw, cell.row, cell.col, yFormulaValues)]];
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSpreadsheetCellPreviewResult {
  /** Extracted cell values, or null if not yet available */
  values: string[][] | null;
  /** Still loading from all sources */
  isLoading: boolean;
}

/**
 * Local-first hook for spreadsheet cell values in documents.
 *
 * Three-tier loading (mirrors useDiagramPreview):
 * 1. IndexedDB — instant cached data from previous spreadsheet opens
 * 2. PartyKit live sync — real-time updates from collaborators
 * 3. Convex cache fallback — server-side spreadsheetCellRefs table
 */
export function useSpreadsheetCellPreview(
  spreadsheetId: Id<"spreadsheets">,
  cellRef: string,
): UseSpreadsheetCellPreviewResult {
  const { isAuthenticated } = useConvexAuth();
  const getToken = useAction(api.collaboration.getCollaborationToken);

  const [localValues, setLocalValues] = useState<string[][] | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Convex cache fallback
  const cellData = useQuery(api.spreadsheetCellRefs.getCellRef, {
    spreadsheetId,
    cellRef,
  });

  useEffect(() => {
    let cancelled = false;
    const shared = acquireSharedDoc(spreadsheetId);
    const { yDoc } = shared;

    const yData = yDoc.getArray<Y.Map<string>>("data");
    const yFormulaValues = yDoc.getMap<string>("formulaValues");

    // Extract current values from Yjs state
    const extract = () => {
      if (cancelled) return;
      const values = extractCellValues(yData, cellRef, yFormulaValues);
      if (values) {
        setLocalValues(values);
        setLocalLoading(false);
      }
    };

    const debouncedExtract = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(extract, DEBOUNCE_MS);
    };

    // If IndexedDB already synced (shared doc reused), extract immediately
    if (shared.indexedDbSynced) {
      extract();
    }

    // Listen for sync/update notifications from the shared doc
    const onNotify = () => debouncedExtract();
    shared.listeners.add(onNotify);

    // Observe Yjs changes for live updates
    yData.observeDeep(debouncedExtract);
    yFormulaValues.observe(debouncedExtract);

    // Connect to PartyKit if not already connected and authenticated
    const connectToParty = async () => {
      if (!isAuthenticated || cancelled || shared.provider) return;

      try {
        const { token } = await getToken({
          resourceType: "spreadsheet",
          resourceId: spreadsheetId,
        });
        if (cancelled) return;

        const host =
          import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999";
        const roomId = `spreadsheet-${spreadsheetId}`;

        const provider = new YPartyKitProvider(host, roomId, yDoc, {
          connect: true,
          params: { token },
        });

        shared.provider = provider;
      } catch (err) {
        console.warn(
          "Spreadsheet cell preview: could not connect to live room:",
          err,
        );
        if (!cancelled) setLocalLoading(false);
      }
    };

    void connectToParty();

    // Fallback timeout — stop loading after 4s if nothing produced data
    const fallbackTimeout = setTimeout(() => {
      if (!cancelled) setLocalLoading(false);
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimeout);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      yData.unobserveDeep(debouncedExtract);
      yFormulaValues.unobserve(debouncedExtract);
      shared.listeners.delete(onNotify);
      releaseSharedDoc(spreadsheetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadsheetId, cellRef, isAuthenticated]);

  // Prefer local values, fall back to Convex cache
  const values = localValues ?? cellData?.values ?? null;
  const isLoading = localLoading && cellData === undefined;

  return { values, isLoading };
}
