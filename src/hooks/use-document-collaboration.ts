import { BlockNoteEditor, BlockNoteSchema, BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { getUserColor } from "../lib/user-colors";
import { useYjsProvider } from "./use-yjs-provider";

export interface UseDocumentCollaborationOptions<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
> {
  documentId: string;
  userName: string;
  userId: string;
  schema: BlockNoteSchema<BSchema, ISchema, SSchema>;
  resourceType?: "doc" | "diagram" | "task";
  enabled?: boolean;
  uploadFile?: (file: File) => Promise<string>;
}

export interface UseDocumentCollaborationResult<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
> {
  editor: BlockNoteEditor<BSchema, ISchema, SSchema> | null;
  isLoading: boolean;
  isConnected: boolean;
  isOffline: boolean;
  provider: ReturnType<typeof useYjsProvider>["provider"];
  yDoc: ReturnType<typeof useYjsProvider>["yDoc"];
}

export function useDocumentCollaboration<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>({
  documentId,
  userName,
  userId,
  schema,
  resourceType = "doc",
  enabled = true,
  uploadFile,
}: UseDocumentCollaborationOptions<BSchema, ISchema, SSchema>): UseDocumentCollaborationResult<BSchema, ISchema, SSchema> {
  const { yDoc, provider, isConnected, isLoading: providerLoading, isOffline } = useYjsProvider({
    resourceType,
    resourceId: documentId,
    enabled,
  });

  const [indexedDbSynced, setIndexedDbSynced] = useState(false);

  // Set up IndexedDB persistence for offline cache
  // CRITICAL: Decouple from provider - IndexedDB initializes independently
  useEffect(() => {
    if (!enabled || !documentId) {
      return;
    }

    const persistence = new IndexeddbPersistence(`${resourceType}-${documentId}`, yDoc);

    persistence.on("synced", () => {
      setIndexedDbSynced(true);
    });

    // Cleanup on unmount or when documentId changes
    return () => {
      void persistence.destroy();
      setIndexedDbSynced(false);
    };
  }, [documentId, resourceType, yDoc, enabled]);

  // Get deterministic user color
  const userColor = getUserColor(userId);

  // Local awareness fallback: allows the editor to bind to the Yjs fragment
  // immediately (before the PartyKit provider connects). When IndexedDB syncs,
  // content appears in the editor right away instead of showing an empty state.
  const localAwareness = useMemo(() => new Awareness(yDoc), [yDoc]);

  // Always create editor with Yjs collaboration so the fragment binding is
  // established from mount. When provider arrives later, editor recreates with
  // the real awareness (content is already in the fragment, so no visual pop).
  const editor = useCreateBlockNote(
    {
      schema,
      uploadFile,
      collaboration: {
        provider: provider ?? { awareness: localAwareness },
        fragment: yDoc.getXmlFragment("document-store"),
        user: {
          name: userName,
          color: userColor,
        },
      },
    },
    [provider, localAwareness, userName, userColor, schema, uploadFile]
  );

  // Loading completes when EITHER provider syncs OR IndexedDB syncs
  const isLoading = providerLoading && !indexedDbSynced;

  return {
    // Editor can render from IndexedDB data even without provider connection
    editor: (provider || indexedDbSynced) ? editor : null,
    isLoading,
    isConnected,
    isOffline,
    provider,
    yDoc,
  };
}
