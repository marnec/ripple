import type { BlockNoteEditor, BlockNoteSchema, BlockSchema, InlineContentSchema, StyleSchema, User } from "@blocknote/core";
import { CommentsExtension, DefaultThreadStoreAuth } from "@blocknote/core/comments";
import { en } from "@blocknote/core/locales";
import { withCollaboration, YjsThreadStore } from "@blocknote/core/yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { useConvex } from "convex/react";
import { useEffect, useMemo } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { extractTextFromXml } from "@ripple/shared/blockRef";
import { getUserColor } from "../lib/user-colors";
import { DOCUMENT_FRAGMENT } from "../lib/collab/room";
import { seedEmptyDocument } from "../lib/collab/empty-document";
import { BOOTSTRAP_ORIGIN } from "../lib/yjs-origins";
import { documentCommentSchema } from "../pages/App/Document/comment-schema";
import { useDescriptionSeedGate, type DescriptionSeed } from "./use-description-seed-gate";
import { useResourceDoc } from "./use-collab-session";
import type { CollaborativeDoc } from "./use-collaborative-doc";

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
  /** Still trying to reach the room — see `CollaborativeDoc.isConnecting`. */
  isConnecting: boolean;
  provider: CollaborativeDoc["provider"];
  yDoc: CollaborativeDoc["yDoc"];
  /**
   * Whether this replica holds the document's real state. When false, `editor`
   * is null and the caller must not offer an editing surface — see
   * `CollaborativeDoc.isHydrated`.
   */
  isHydrated: boolean;
  /** This room's local key/value store — see `CollaborativeDoc.roomStore`. */
  roomStore: CollaborativeDoc["roomStore"];
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
  const {
    yDoc,
    provider,
    awareness,
    isConnected,
    isConnecting,
    isLoading,
    isOffline,
    isCacheLoaded,
    isHydrated,
    roomStore,
  } = useResourceDoc({ resourceType, resourceId: documentId, enabled });

  // Derived, not stored: `isCacheLoaded` only flips once per document, and
  // reading the fragment is what "did the cache have anything" means.
  //
  // Only the seed gate needs this, and it needs actual TEXT rather than block
  // count: BlockNote seeds an empty document with a blank paragraph, so a count
  // would falsely report "cached content" and unblock the editor before a
  // GitHub description seed lands. Whether there is anything to *show* is
  // `isHydrated`'s question, not this one.
  const cachedFragment = isCacheLoaded ? yDoc.getXmlFragment(DOCUMENT_FRAGMENT) : null;
  const cachedTextReady =
    cachedFragment !== null && extractTextFromXml(cachedFragment).trim().length > 0;

  // Get deterministic user color
  const userColor = getUserColor(userId);

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
    withCollaboration({
      schema,
      uploadFile,
      dictionary,
      extensions: commentsExtension ? [commentsExtension] : undefined,
      collaboration: {
        // `awareness` is the provider's once connected, and a local one before
        // that — so the editor binds to the fragment at mount and cached
        // content appears without waiting for a socket.
        provider: provider ?? { awareness },
        fragment: yDoc.getXmlFragment(DOCUMENT_FRAGMENT),
        user: {
          name: userName,
          color: userColor,
        },
      },
    }),
    [provider, awareness, userName, userColor, schema, uploadFile, dictionary, commentsExtension]
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

  // Materialise "empty" once we are entitled to say the document *is* empty.
  // Both conditions matter: `isHydrated` means we know the contents, and
  // `descriptionReady` means no server-authored description is still on its
  // way (a GitHub seed brings a root of its own, and two roots is exactly what
  // this is here to prevent).
  useEffect(() => {
    if (!isHydrated || !descriptionReady) return;
    seedEmptyDocument(yDoc, BOOTSTRAP_ORIGIN);
  }, [isHydrated, descriptionReady, yDoc]);

  return {
    // One gate: do we hold the document's state? `isHydrated` is exactly the
    // question the editor needs answered — a sync, a non-empty cache, or a
    // stored snapshot — and nothing else about the connection matters.
    //
    // It used to additionally require `isConnected || isOffline || provider`,
    // which meant a document already cached on the device stayed behind a
    // blank page until the *network* reached a verdict. With the browser still
    // reporting itself online but nothing answering, that verdict only came
    // when the token mint gave up, so the page hung and then opened already
    // marked offline. Connection state belongs in the toolbar, not in whether
    // there is a document to show.
    //
    // `descriptionReady` stays: a task expecting a GitHub seed is waiting on
    // content that really is still coming.
    editor: isHydrated && descriptionReady ? editor : null,
    isLoading,
    isConnected,
    isConnecting,
    isOffline,
    isHydrated,
    roomStore,
    provider,
    yDoc,
    descriptionReady,
    awaitingSeed,
  };
}
