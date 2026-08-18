import { useEffect, useRef } from "react";
import type { ExcalidrawBinding } from "y-excalidraw";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { getUserColor } from "../lib/user-colors";
import { useResourceDoc } from "./use-collab-session";
import type { CollaborativeDoc } from "./use-collaborative-doc";

export interface UseDiagramCollaborationOptions {
  diagramId: string;
  userName: string;
  userId: string;
}

export interface UseDiagramCollaborationResult {
  yDoc: Y.Doc;
  provider: CollaborativeDoc["provider"];
  isConnected: boolean;
  isOffline: boolean;
  isLoading: boolean;
  /** See `CollaborativeDoc.isHydrated` — false means "contents unknown". */
  isHydrated: boolean;
  yElements: Y.Array<Y.Map<any>>;
  yAssets: Y.Map<any>;
  awareness: Awareness;
  bindingRef: React.MutableRefObject<ExcalidrawBinding | null>;
}

/**
 * Binds a diagram's collaborative document to Excalidraw's shape.
 *
 * The document, the provider, offline persistence and teardown all belong to
 * `useResourceDoc`; what's left here is the Yjs structures y-excalidraw expects
 * and this user's cursor identity.
 *
 * `ExcalidrawBinding` itself is created in the component — it needs the
 * `excalidrawAPI`, which only exists after mount.
 */
export function useDiagramCollaboration({
  diagramId,
  userName,
  userId,
}: UseDiagramCollaborationOptions): UseDiagramCollaborationResult {
  const { yDoc, provider, awareness, isConnected, isLoading, isOffline, isHydrated } =
    useResourceDoc({
      resourceType: "diagram",
      resourceId: diagramId,
    });

  const bindingRef = useRef<ExcalidrawBinding | null>(null);

  const yElements = yDoc.getArray<Y.Map<any>>("elements");
  const yAssets = yDoc.getMap("assets");

  const userColor = getUserColor(userId);
  useEffect(() => {
    awareness.setLocalStateField("user", { name: userName, color: userColor });
  }, [awareness, userName, userColor]);

  return {
    yDoc,
    provider,
    isConnected,
    isOffline,
    isLoading,
    isHydrated,
    yElements,
    yAssets,
    awareness,
    bindingRef,
  };
}
