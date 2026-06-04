import type { BlockNoteEditor, BlockNoteSchema, BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import { CommentsExtension, DefaultThreadStoreAuth, YjsThreadStore, type User } from "@blocknote/core/comments";
import { en } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { useConvex } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { extractTextFromXml } from "@ripple/shared/blockRef";
import { getUserColor } from "../lib/user-colors";
import { documentCommentSchema } from "../pages/App/Document/comment-schema";
import { useDescriptionSeedGate, type DescriptionSeed } from "./use-description-seed-gate";
import { useYjsProvider } from "./use-yjs-provider";

export type { DescriptionSeed } from "./use-description-seed-gate";

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
  /** Optional BlockNote dictionary override (used for placeholder customization). */
  dictionary?: typeof en;
  /**
   * Task-only: GitHub description-seed signals. When present, the editor is held
   * back behind a spinner until the seed lands (or times out) so the user can't
   * type into a doc that's about to be filled. Omit for docs/diagrams.
   */
  seed?: DescriptionSeed;
  /**
   * Enable BlockNote collaborative comments (threads live in the Y.Doc's
   * `threads` map, so they persist through the same snapshot/IndexedDB path as
   * the document body). Only meaningful for real documents — leave off for the
   * task-description editor. Requires a stable, real `userId` (not the
   * "anonymous" fallback), so callers should gate on a loaded viewer.
   */
  enableComments?: boolean;
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
  /**
   * False only while a task editor is intentionally held back waiting for a
   * GitHub description seed to load. `true` for all other cases (no seed
   * expected, cache present, snapshot loaded, or timed out). Drives the
   * "blocking spinner" state in the task description editor.
   */
  descriptionReady: boolean;
  /**
   * True while the editor is specifically held back waiting for a GitHub
   * description seed (not generic provider loading). Drives the "seeding from
   * GitHub" disclaimer; false once the seed lands or the wait times out.
   */
  awaitingSeed: boolean;
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
  dictionary,
  seed,
  enableComments = false,
}: UseDocumentCollaborationOptions<BSchema, ISchema, SSchema>): UseDocumentCollaborationResult<BSchema, ISchema, SSchema> {
  const { yDoc, provider, isConnected, isLoading: providerLoading, isOffline } = useYjsProvider({
    resourceType,
    resourceId: documentId,
    enabled,
  });

  const [indexedDbSynced, setIndexedDbSynced] = useState(false);
  // True when IndexedDB loaded AND the Yjs fragment has cached blocks (any
  // block count). Used to show the editor from cache without waiting for the
  // provider — valid for docs/diagrams whose content may be non-text.
  const [cachedContentReady, setCachedContentReady] = useState(false);
  // Like above but requires actual TEXT. The seed gate must use this: BlockNote
  // seeds an empty doc with a blank paragraph (block count 1, no text), so the
  // plain count would falsely report "cached content" and unblock the editor
  // before the GitHub seed lands.
  const [cachedTextReady, setCachedTextReady] = useState(false);

  // Set up IndexedDB persistence for offline cache
  // CRITICAL: Decouple from provider - IndexedDB initializes independently
  useEffect(() => {
    if (!enabled || !documentId) {
      return;
    }

    const persistence = new IndexeddbPersistence(`${resourceType}-${documentId}`, yDoc);

    persistence.on("synced", () => {
      setIndexedDbSynced(true);
      const fragment = yDoc.getXmlFragment("document-store");
      if (fragment.length > 0) {
        setCachedContentReady(true);
      }
      if (extractTextFromXml(fragment).trim().length > 0) {
        setCachedTextReady(true);
      }
    });

    // Cleanup on unmount or when documentId changes
    return () => {
      void persistence.destroy();
      setIndexedDbSynced(false);
      setCachedContentReady(false);
      setCachedTextReady(false);
    };
  }, [documentId, resourceType, yDoc, enabled]);

  // Get deterministic user color
  const userColor = getUserColor(userId);

  // Local awareness fallback: allows the editor to bind to the Yjs fragment
  // immediately (before the PartyKit provider connects). When IndexedDB syncs,
  // content appears in the editor right away instead of showing an empty state.
  const localAwareness = useMemo(() => new Awareness(yDoc), [yDoc]);

  const convex = useConvex();

  // Collaborative comments extension. Threads are stored in the Y.Doc's
  // `threads` map (same doc as the body fragment), so they ride along the
  // existing snapshot + IndexedDB persistence and the partyserver Yjs sync —
  // no separate backend. Author identity is resolved on demand from Convex.
  // `DefaultThreadStoreAuth(userId, "editor")` mirrors the doc's access model:
  // every workspace member can edit the document, so every member is an editor
  // of its comments (can delete any thread). Author-only rules (edit own
  // comment) are enforced per-comment by the auth class.
  const commentsExtension = useMemo(() => {
    if (!enableComments) return undefined;
    const threadStore = new YjsThreadStore(
      userId,
      yDoc.getMap("threads"),
      new DefaultThreadStoreAuth(userId, "editor"),
    );
    const resolveUsers = async (userIds: string[]): Promise<User[]> => {
      let userMap: Partial<Record<Id<"users">, { name?: string; image?: string }>> = {};
      try {
        userMap = await convex.query(api.users.getByIds, {
          ids: userIds as Id<"users">[],
        });
      } catch {
        // A comment authored by an id that no longer resolves (or an unexpected
        // id shape) must not blow up the whole editor — fall back to placeholders.
      }
      return userIds.map((id) => {
        const user = userMap[id as Id<"users">];
        return {
          id,
          username: user?.name ?? "Unknown user",
          avatarUrl: user?.image ?? "",
        };
      });
    };
    // Pass the shared comment schema so BlockNote renders stored bodies with the
    // same schema the rail's composer authors them in (see comment-schema.ts).
    return CommentsExtension({ threadStore, resolveUsers, schema: documentCommentSchema });
  }, [enableComments, userId, yDoc, convex]);

  // Always create editor with Yjs collaboration so the fragment binding is
  // established from mount. When provider arrives later, editor recreates with
  // the real awareness (content is already in the fragment, so no visual pop).
  const editor = useCreateBlockNote(
    {
      schema,
      uploadFile,
      dictionary,
      extensions: commentsExtension ? [commentsExtension] : undefined,
      collaboration: {
        provider: provider ?? { awareness: localAwareness },
        fragment: yDoc.getXmlFragment("document-store"),
        user: {
          name: userName,
          color: userColor,
        },
      },
    },
    [provider, localAwareness, userName, userColor, schema, uploadFile, dictionary, commentsExtension]
  );

  // Workaround for BlockNote #2244 / y-prosemirror #102: when ProseMirror
  // reconfigures plugins (StrictMode double-mount, extension changes, editor
  // recreation), yUndoPlugin's view destroy() calls undoManager.destroy() —
  // unbinding the afterTransaction handler, clearing observers, removing the
  // UM from its own trackedOrigins. Plugin state still references the same
  // (now zombie) UM. Rebind on every TipTap transaction to keep it healthy.
  useEffect(() => {
    if (!editor) return;
    const tiptap = (editor as unknown as { _tiptapEditor?: { view?: { state: { plugins: Array<{ spec: { key?: { key?: string } }; getState: (s: unknown) => unknown }> } }; on: (event: string, handler: () => void) => void; off: (event: string, handler: () => void) => void } })._tiptapEditor;
    if (!tiptap) return;

    const ensureBound = () => {
      const view = tiptap.view;
      if (!view) return;
      const yUndo = view.state.plugins.find((p) => p.spec.key?.key?.startsWith("y-undo$"));
      if (!yUndo) return;
      const um = (yUndo.getState(view.state) as { undoManager?: { afterTransactionHandler?: (tr: unknown) => void; trackedOrigins: Set<unknown>; doc: { off: (e: string, h: unknown) => void; on: (e: string, h: unknown) => void } } } | null)?.undoManager;
      if (!um?.afterTransactionHandler) return;
      um.doc.off("afterTransaction", um.afterTransactionHandler);
      um.doc.on("afterTransaction", um.afterTransactionHandler);
      um.trackedOrigins.add(um);
    };

    ensureBound();
    tiptap.on("transaction", ensureBound);
    return () => {
      tiptap.off("transaction", ensureBound);
    };
  }, [editor, yDoc]);

  // Task-only GitHub description-seed gate: holds the editor back until a seed
  // lands (or times out) and exposes the disclaimer state. Inert (always ready)
  // for docs/diagrams, which pass no `seed`.
  const { descriptionReady, awaitingSeed } = useDescriptionSeedGate({
    resourceType,
    documentId,
    yDoc,
    isOffline,
    hasCachedText: cachedTextReady,
    seed,
  });

  // Loading completes when EITHER provider syncs OR IndexedDB syncs
  const isLoading = providerLoading && !indexedDbSynced;

  return {
    // Gate editor on content readiness to prevent empty-editor flash:
    // - isConnected: provider synced (authoritative state, even if empty)
    // - isOffline: timeout fallback, show whatever we have
    // - cachedContentReady && provider: IndexedDB had real content AND editor
    //   already recreated with real provider awareness (no second flash)
    // ...AND descriptionReady, so a task expecting a seed stays gated until the
    // seed loads (or times out). Non-task callers always have descriptionReady.
    editor:
      (isConnected || isOffline || (cachedContentReady && !!provider)) && descriptionReady
        ? editor
        : null,
    isLoading,
    isConnected,
    isOffline,
    provider,
    yDoc,
    descriptionReady,
    awaitingSeed,
  };
}
