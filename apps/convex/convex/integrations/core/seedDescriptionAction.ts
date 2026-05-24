"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { JSDOM } from "jsdom";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc } from "@blocknote/core/yjs";
import * as Y from "yjs";

/**
 * One-time seed of a task's collaborative description from the GitHub issue
 * body captured at creation (`taskIntegrationLinks.initialBodyMarkdown`).
 *
 * Task descriptions are Yjs documents, not Convex fields: the client editor
 * binds to `yDoc.getXmlFragment("document-store")` and the cold-start source
 * is the binary snapshot in `_storage` referenced by `tasks.yjsSnapshotId`.
 * So "seeding" means producing that snapshot before any client connects.
 *
 * We deliberately use `@blocknote/core` (+ `@blocknote/core/yjs`) rather than
 * `@blocknote/server-util`: server-util pulls `@blocknote/react`, which drags
 * `react-icons` (~22 MiB) + emoji data into the Node external-package
 * artifact (no tree-shaking on externals), blowing Convex's ~43 MiB ceiling.
 * The headless core has everything the conversion needs and none of the UI.
 *
 * Markdown import only yields default block types, and the client's
 * `taskDescriptionSchema` is a superset of the defaults, so the snapshot loads
 * cleanly without replicating the custom blocks (diagram/spreadsheet/etc.)
 * server-side.
 *
 * Scheduled (runAfter 0) from `createTaskFromEvent`, covering both the initial
 * bulk import and webhook sync-down of new issues. Best-effort: a brand-new
 * task isn't being viewed yet, so the snapshot lands before the first
 * PartyKit `onLoad`. If the body is empty there is nothing to seed.
 */
export const seedTaskDescription = internalAction({
  args: { taskId: v.id("tasks"), markdown: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, markdown }) => {
    if (markdown.trim().length === 0) return null;

    // Cheap pre-check: if the task already has a description snapshot (a
    // collaborator edited it, or a previous seed ran), skip the conversion
    // entirely. The write below is still guarded atomically against the race.
    const existing = await ctx.runQuery(internal.snapshots.getSnapshot, {
      resourceType: "task",
      resourceId: taskId,
    });
    if (existing) return null;

    // BlockNote's markdown parser walks the DOM, so install a document/window
    // for the duration of the conversion. linkedom would be lighter but jsdom
    // is already pulled by the web app and keeps us well under the limit.
    const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>");
    const prevWindow = (globalThis as { window?: unknown }).window;
    const prevDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { window?: unknown }).window = dom.window;
    (globalThis as { document?: unknown }).document = dom.window.document;

    try {
      const editor = BlockNoteEditor.create();
      const blocks = await editor.tryParseMarkdownToBlocks(markdown);
      if (blocks.length === 0) return null;

      const ydoc = blocksToYDoc(editor, blocks, "document-store");
      const update = Y.encodeStateAsUpdate(ydoc);
      // `update` is a Uint8Array, a valid BlobPart at runtime; the cast bridges
      // a lib typing nuance (Uint8Array<ArrayBufferLike> vs BlobPart).
      const storageId = await ctx.storage.store(new Blob([update as BlobPart], { type: "application/octet-stream" }));

      // Guarded write: overwrites a non-user (e.g. empty auto-saved) snapshot
      // but never a user-edited description (drops the blob otherwise).
      await ctx.runMutation(internal.snapshots.seedTaskSnapshot, {
        taskId,
        storageId,
      });
    } finally {
      (globalThis as { window?: unknown }).window = prevWindow;
      (globalThis as { document?: unknown }).document = prevDocument;
    }

    return null;
  },
});
