import { BlockNoteEditor, BlockNoteSchema, BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect, useState } from "react";
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
}

export interface UseDocumentCollaborationResult<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
> {
  editor: BlockNoteEditor<BSchema, ISchema, SSchema> | null;
  isLoading: boolean;
  isConnected: boolean;
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
}: UseDocumentCollaborationOptions<BSchema, ISchema, SSchema>): UseDocumentCollaborationResult<BSchema, ISchema, SSchema> {
  const { yDoc, provider, isConnected, isLoading: providerLoading } = useYjsProvider({
    resourceType,
    resourceId: documentId,
  });

  const [indexedDbSynced, setIndexedDbSynced] = useState(false);

  // Set up IndexedDB persistence for offline cache
  useEffect(() => {
    if (!provider) return;

    const persistence = new IndexeddbPersistence(`${resourceType}-${documentId}`, yDoc);

    persistence.on("synced", () => {
      setIndexedDbSynced(true);
    });

    // Cleanup on unmount or when provider/documentId changes
    return () => {
      void persistence.destroy();
      setIndexedDbSynced(false);
    };
  }, [provider, documentId, resourceType, yDoc]);

  // Get deterministic user color
  const userColor = getUserColor(userId);

  // Create BlockNote editor with Yjs collaboration
  const editor = useCreateBlockNote(
    {
      schema,
      collaboration: provider
        ? {
            provider,
            fragment: yDoc.getXmlFragment("document-store"),
            user: {
              name: userName,
              color: userColor,
            },
          }
        : undefined,
    },
    [provider, userName, userColor, schema]
  );

  const isLoading = providerLoading || !indexedDbSynced;

  return {
    editor: provider ? editor : null,
    isLoading,
    isConnected,
    provider,
    yDoc,
  };
}
