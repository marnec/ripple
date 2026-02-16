import { useEffect, useMemo, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { getUserColor } from "../lib/user-colors";
import { useYjsProvider } from "./use-yjs-provider";

export interface UseSpreadsheetCollaborationOptions {
  spreadsheetId: string;
  userName: string;
  userId: string;
}

export interface UseSpreadsheetCollaborationResult {
  yDoc: Y.Doc;
  provider: ReturnType<typeof useYjsProvider>["provider"];
  awareness: NonNullable<ReturnType<typeof useYjsProvider>["provider"]>["awareness"] | null;
  isConnected: boolean;
  isOffline: boolean;
  isLoading: boolean;
}

/**
 * Hook to manage spreadsheet collaboration with Yjs.
 *
 * Provides:
 * - Yjs document and PartyKit provider
 * - IndexedDB persistence for offline editing
 * - Awareness API for cursor tracking
 *
 * The SpreadsheetYjsBinding class (created in the component)
 * handles the two-way sync between jspreadsheet-ce and the Yjs document.
 */
export function useSpreadsheetCollaboration({
  spreadsheetId,
  userName,
  userId,
}: UseSpreadsheetCollaborationOptions): UseSpreadsheetCollaborationResult {
  const {
    yDoc,
    provider,
    isConnected,
    isLoading: providerLoading,
    isOffline,
  } = useYjsProvider({
    resourceType: "spreadsheet",
    resourceId: spreadsheetId,
  });

  const [indexedDbSynced, setIndexedDbSynced] = useState(false);

  // Set up IndexedDB persistence for offline cache
  // CRITICAL: Decouple from provider - IndexedDB initializes independently
  useEffect(() => {
    const persistence = new IndexeddbPersistence(
      `spreadsheet-${spreadsheetId}`,
      yDoc,
    );

    persistence.on("synced", () => {
      setIndexedDbSynced(true);
    });

    return () => {
      void persistence.destroy();
      setIndexedDbSynced(false);
    };
  }, [spreadsheetId, yDoc]);

  // Get deterministic user color
  const userColor = useMemo(() => getUserColor(userId), [userId]);

  // Set awareness user info
  useEffect(() => {
    if (!provider) return;

    provider.awareness.setLocalStateField("user", {
      name: userName,
      color: userColor,
    });
  }, [provider, userName, userColor]);

  // Loading completes when EITHER provider syncs OR IndexedDB syncs
  const isLoading = providerLoading && !indexedDbSynced;

  return {
    yDoc,
    provider,
    awareness: provider ? provider.awareness : null,
    isConnected,
    isOffline,
    isLoading,
  };
}
