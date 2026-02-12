import { useEffect, useMemo, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import type { ExcalidrawBinding } from "y-excalidraw";
import * as Y from "yjs";
import { getUserColor } from "../lib/user-colors";
import { useYjsProvider } from "./use-yjs-provider";

export interface UseDiagramCollaborationOptions {
  diagramId: string;
  userName: string;
  userId: string;
}

export interface UseDiagramCollaborationResult {
  yDoc: Y.Doc;
  provider: ReturnType<typeof useYjsProvider>["provider"];
  isConnected: boolean;
  isOffline: boolean;
  isLoading: boolean;
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: ReturnType<typeof useYjsProvider>["provider"] extends null
    ? null
    : NonNullable<ReturnType<typeof useYjsProvider>["provider"]>["awareness"] | null;
  bindingRef: React.MutableRefObject<ExcalidrawBinding | null>;
}

/**
 * Hook to manage Excalidraw diagram collaboration with Yjs.
 *
 * Provides:
 * - Yjs document and PartyKit provider
 * - IndexedDB persistence for offline editing
 * - Awareness API for cursor tracking
 * - yElements and yAssets for y-excalidraw binding
 *
 * Note: ExcalidrawBinding creation is handled in the component
 * (requires excalidrawAPI which is only available after mount).
 */
export function useDiagramCollaboration({
  diagramId,
  userName,
  userId,
}: UseDiagramCollaborationOptions): UseDiagramCollaborationResult {
  const { yDoc, provider, isConnected, isLoading: providerLoading, isOffline } = useYjsProvider({
    resourceType: "diagram",
    resourceId: diagramId,
  });

  const [indexedDbSynced, setIndexedDbSynced] = useState(false);
  const bindingRef = useRef<ExcalidrawBinding | null>(null);

  // Create stable Yjs structures for Excalidraw elements and assets
  const yElements = useMemo(() => yDoc.getArray<Y.Map<any>>("elements"), [yDoc]);
  const yAssets = useMemo(() => yDoc.getMap("assets"), [yDoc]);

  // Set up IndexedDB persistence for offline cache
  // CRITICAL: Decouple from provider - IndexedDB initializes independently
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`diagram-${diagramId}`, yDoc);

    persistence.on("synced", () => {
      setIndexedDbSynced(true);
    });

    // Cleanup on unmount or when diagramId changes
    return () => {
      void persistence.destroy();
      setIndexedDbSynced(false);
    };
  }, [diagramId, yDoc]);

  // Get deterministic user color
  const userColor = getUserColor(userId);

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
    isConnected,
    isOffline,
    isLoading,
    yElements,
    yAssets,
    awareness: provider ? provider.awareness : null,
    bindingRef,
  };
}
