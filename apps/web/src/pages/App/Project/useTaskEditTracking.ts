import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { useDocumentCollaboration } from "../../../hooks/use-document-collaboration";
import type { BlockNoteEditor } from "@blocknote/core";
import { extractEventMentions } from "../../../hooks/use-editor-tracking";
import { SEED_ORIGIN } from "@/lib/yjs-origins";

// The trackers only read `editor.document` / `editor.onChange`, so the editor
// is accepted schema-erased (the concrete schema editor is invariant and won't
// assign to the collaboration hook's default-param return type). yDoc keeps its
// exact type from the collaboration hook (no runtime import).
type CollabEditor = BlockNoteEditor<any, any, any> | null;
type CollabYDoc = ReturnType<typeof useDocumentCollaboration>["yDoc"];

// Delay before edit-detection arms, so BlockNote's mount-time default-paragraph
// insert and any post-seed normalization (both local Yjs transactions) don't
// get mistaken for a user edit.
const DESCRIPTION_EDIT_SETTLE_MS = 400;

/** Debounce window for the cache-cleanup trackers (embeds, doc-block refs). */
const REF_SYNC_DEBOUNCE_MS = 2000;

/** Extract all @mention user IDs from task description blocks. */
function extractMentionUserIds(blocks: any[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "userMention" && ic.props?.userId) {
          ids.add(ic.props.userId);
        }
      }
    }
    if (block.children) {
      for (const id of extractMentionUserIds(block.children)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

/** Extract all hard-embed reference keys from task description (diagrams + document block embeds). */
function extractTaskEmbedRefs(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (block.type === "diagram" && block.props?.diagramId) {
      // 3rd segment = embedded frame id ("" = whole diagram).
      refs.add(`diagram|${block.props.diagramId}|${block.props.frameId ?? ""}`);
    }
    if (block.type === "documentBlockEmbed" && block.props?.documentId) {
      refs.add(`document|${block.props.documentId}`);
    }
    if (block.type === "spreadsheetRange" && block.props?.spreadsheetId) {
      refs.add(`spreadsheet|${block.props.spreadsheetId}`);
    }
    if (Array.isArray(block.content)) {
      for (const ic of block.content) {
        if (ic.type === "diagramEmbed" && ic.props?.diagramId) {
          // Inline diagram embeds are always whole-diagram (no frame picker).
          refs.add(`diagram|${ic.props.diagramId}|`);
        }
      }
    }
    if (block.children) {
      for (const key of extractTaskEmbedRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Extract documentBlockEmbed keys (documentId|blockId) for block ref cache cleanup. */
function extractTaskDocBlockRefs(blocks: any[]): Set<string> {
  const refs = new Set<string>();
  for (const block of blocks) {
    if (block.type === "documentBlockEmbed" && block.props?.documentId && block.props?.blockId) {
      refs.add(`${block.props.documentId}|${block.props.blockId}`);
    }
    if (block.children) {
      for (const key of extractTaskDocBlockRefs(block.children)) {
        refs.add(key);
      }
    }
  }
  return refs;
}

/** Parse "type|id" (or "diagram|id|frameId") keys into the edges-table reference shape. Pure + module-scoped. */
function parseEmbedRefs(keys: Set<string>) {
  return [...keys].map((key) => {
    const [targetType, targetId, frameId] = key.split("|");
    return {
      targetType: targetType as "diagram" | "document" | "spreadsheet",
      targetId,
      frameId: frameId || undefined,
    };
  });
}

/**
 * All description-editor tracking side effects for a task, behind one call.
 * Owns the mutations it drives, so the host hook doesn't thread them through.
 * Hidden inside: five independent trackers over the live BlockNote/Yjs doc —
 *  1. embed refs (diagrams/doc-blocks/spreadsheets) → edges, debounced + diffed;
 *  2. document-block refs → cache cleanup on removal, debounced;
 *  3. @user mentions → mention edges + notifications for newly-added users;
 *  4. @event mentions → mention edges;
 *  5. first genuine local edit → `markDescriptionEdited` (gates the GitHub
 *     sync button; armed after a settle window, ignores seed/remote transactions).
 * No return value — purely effects.
 */
export function useTaskEditTracking({
  editor,
  yDoc,
  taskId,
  workspaceId,
  descriptionReady,
  isGithubLinked,
  descriptionEdited,
}: {
  editor: CollabEditor;
  yDoc: CollabYDoc;
  taskId: Id<"tasks"> | null;
  workspaceId: Id<"workspaces">;
  descriptionReady: boolean;
  isGithubLinked: boolean;
  descriptionEdited: boolean;
}): void {
  const syncEdges = useMutation(api.edges.syncEdges);
  const syncMentionEdges = useMutation(api.edges.syncMentionEdges);
  const removeBlockRef = useMutation(api.documentBlockRefs.removeBlockRef);
  const notifyMentions = useMutation(api.tasks.notifyDescriptionMentions);
  const markDescriptionEdited = useMutation(api.tasks.markDescriptionEdited);

  // Mark the description as user-edited (persisted on the link) the first time
  // a GENUINE local edit lands, so the "Sync to GitHub" button appears only
  // after a real edit — never for the seed itself. Guards:
  //  - only for linked, not-yet-edited tasks once the editor is ready,
  //  - a settle window so mount/normalization transactions don't count,
  //  - tr.local excludes the seed (applyUpdate) and remote collaborators,
  //  - SEED_ORIGIN is belt-and-suspenders for our own snapshot apply,
  //  - tr.changed.size>0 skips selection-only transactions.
  useEffect(() => {
    if (!yDoc || !taskId) return;
    if (!isGithubLinked || descriptionEdited || !descriptionReady) return;

    let armed = false;
    const armTimer = setTimeout(() => {
      armed = true;
    }, DESCRIPTION_EDIT_SETTLE_MS);

    const onAfterTransaction = (tr: {
      local: boolean;
      origin: unknown;
      changed: { size: number };
    }) => {
      if (!armed) return;
      if (!tr.local || tr.origin === SEED_ORIGIN || tr.changed.size === 0) return;
      yDoc.off("afterTransaction", onAfterTransaction);
      void markDescriptionEdited({ taskId });
    };

    yDoc.on("afterTransaction", onAfterTransaction);
    return () => {
      clearTimeout(armTimer);
      yDoc.off("afterTransaction", onAfterTransaction);
    };
  }, [yDoc, taskId, isGithubLinked, descriptionEdited, descriptionReady, markDescriptionEdited]);

  // Sync embed references (diagrams + document block embeds) to edges table
  const prevEmbedsRef = useRef<Set<string>>(new Set());
  const embedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractTaskEmbedRefs(editor.document);
    prevEmbedsRef.current = initial;

    // Sync on mount so pre-existing embeds get tracked
    if (initial.size > 0) {
      void syncEdges({
        sourceType: "task",
        sourceId: taskId,
        references: parseEmbedRefs(initial),
        workspaceId,
      });
    }

    const unsubscribe = editor.onChange(() => {
      if (embedDebounceRef.current) clearTimeout(embedDebounceRef.current);
      embedDebounceRef.current = setTimeout(() => {
        const current = extractTaskEmbedRefs(editor.document);
        if (current.size !== prevEmbedsRef.current.size ||
            [...current].some((k) => !prevEmbedsRef.current.has(k))) {
          void syncEdges({
            sourceType: "task",
            sourceId: taskId,
            references: parseEmbedRefs(current),
            workspaceId,
          });
        }
        prevEmbedsRef.current = current;
      }, REF_SYNC_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (embedDebounceRef.current) clearTimeout(embedDebounceRef.current);
    };
  }, [editor, taskId, workspaceId, syncEdges]);

  // Track document block ref removals for cache cleanup
  const prevDocBlockRefsRef = useRef<Set<string>>(new Set());
  const docBlockRefDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editor || !taskId) return;
    prevDocBlockRefsRef.current = extractTaskDocBlockRefs(editor.document);

    const unsubscribe = editor.onChange(() => {
      if (docBlockRefDebounceRef.current) clearTimeout(docBlockRefDebounceRef.current);
      docBlockRefDebounceRef.current = setTimeout(() => {
        const current = extractTaskDocBlockRefs(editor.document);
        // Clean up removed block refs
        for (const key of prevDocBlockRefsRef.current) {
          if (!current.has(key)) {
            const [documentId, blockId] = key.split("|");
            void removeBlockRef({
              documentId: documentId as Id<"documents">,
              blockId,
            });
          }
        }
        prevDocBlockRefsRef.current = current;
      }, REF_SYNC_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (docBlockRefDebounceRef.current) clearTimeout(docBlockRefDebounceRef.current);
    };
  }, [editor, taskId, removeBlockRef]);

  // Track @mentions in task description: sync to edges + notify new mentions
  const prevMentionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractMentionUserIds(editor.document);
    prevMentionsRef.current = initial;

    // Sync on mount so pre-existing mentions get tracked
    if (initial.size > 0) {
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedUserIds: [...initial],
        workspaceId,
      });
    }

    const unsubscribe = editor.onChange(() => {
      const current = extractMentionUserIds(editor.document);
      // Sync mention edges (persistent graph)
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedUserIds: [...current],
        workspaceId,
      });
      // Notify newly mentioned users
      const added = [...current].filter((id) => !prevMentionsRef.current.has(id));
      if (added.length > 0) {
        void notifyMentions({
          taskId,
          mentionedUserIds: added as Id<"users">[],
        });
      }
      prevMentionsRef.current = current;
    });

    return () => { unsubscribe(); };
  }, [editor, taskId, workspaceId, notifyMentions, syncMentionEdges]);

  // Track @event mentions in task description: sync to mention edges. The
  // mutation diffs user / event edges independently, so this runs alongside
  // the user-mention effect without interference.
  useEffect(() => {
    if (!editor || !taskId) return;
    const initial = extractEventMentions(editor.document);
    if (initial.size > 0) {
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedEventIds: [...initial],
        workspaceId,
      });
    }
    const unsubscribe = editor.onChange(() => {
      const current = extractEventMentions(editor.document);
      void syncMentionEdges({
        sourceType: "task",
        sourceId: taskId,
        mentionedEventIds: [...current],
        workspaceId,
      });
    });
    return () => { unsubscribe(); };
  }, [editor, taskId, workspaceId, syncMentionEdges]);
}
