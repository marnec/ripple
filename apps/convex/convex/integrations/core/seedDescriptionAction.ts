"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { markdownToYjsUpdate } from "../../lib/headlessEditor";

/**
 * One-time seed of a task's collaborative description from the GitHub issue
 * body captured at creation (`taskIntegrationLinks.initialBodyMarkdown`).
 *
 * Task descriptions are Yjs documents, not Convex fields: the client editor
 * binds to `yDoc.getXmlFragment("document-store")` and the cold-start source
 * is the binary snapshot in `_storage` referenced by `tasks.yjsSnapshotId`.
 * So "seeding" means producing that snapshot before any client connects. The
 * markdown → Yjs conversion runs through the shared headless editor
 * (`lib/headlessEditor` → `markdownToYjsUpdate`), which owns the JSDOM shim and
 * the bundle-size reasons we avoid `@blocknote/server-util`.
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

    // Every exit below must reach a terminal seed status so the client's gate
    // stops waiting deterministically (success → seedTaskSnapshot, nothing to
    // seed → "skipped", thrown → "failed"). The outer catch covers the throw.
    try {
      // Cheap pre-check: if the task already has a description snapshot (a
      // collaborator edited it, or a previous seed ran), skip the conversion
      // entirely. The write below is still guarded atomically against the race.
      const existing = await ctx.runQuery(internal.snapshots.getSnapshot, {
        resourceType: "task",
        resourceId: taskId,
      });
      if (existing) {
        await ctx.runMutation(internal.snapshots.markSeedStatus, {
          taskId,
          status: "skipped",
        });
        return null;
      }

      const update = await markdownToYjsUpdate(markdown);
      if (!update) {
        // Parsed to zero blocks — nothing to seed.
        await ctx.runMutation(internal.snapshots.markSeedStatus, {
          taskId,
          status: "skipped",
        });
        return null;
      }

      // `update` is a Uint8Array, a valid BlobPart at runtime; the cast bridges
      // a lib typing nuance (Uint8Array<ArrayBufferLike> vs BlobPart).
      const storageId = await ctx.storage.store(
        new Blob([update as BlobPart], { type: "application/octet-stream" }),
      );

      // Guarded write: overwrites a non-user (e.g. empty auto-saved) snapshot
      // but never a user-edited description (drops the blob otherwise). Sets
      // the terminal "seeded"/"skipped" status itself.
      await ctx.runMutation(internal.snapshots.seedTaskSnapshot, {
        taskId,
        storageId,
      });
    } catch (error) {
      await ctx.runMutation(internal.snapshots.markSeedStatus, {
        taskId,
        status: "failed",
      });
      throw error;
    }

    return null;
  },
});
