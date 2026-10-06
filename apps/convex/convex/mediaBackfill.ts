import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auditLog } from "./auditLog";
import { syncOwnerRefs } from "./mediaRefs";
import { extractMediaTokens, mediaTokenFromUrl, type MediaOwnerType } from "./utils/mediaTokens";

/**
 * Bring uploads that predate `mediaRefs` under reference tracking — the
 * retroactive half of "an upload lives as long as something shows it".
 *
 *   npx convex run mediaBackfill:start            (dev)
 *   npx convex run mediaBackfill:start --prod
 *
 * One self-scheduling chain, each step starting the next when it runs out of
 * rows. The order is the safety argument:
 *
 *   1. tokens     — give every `medias` row the token its URL carries, so
 *                   content can be matched back to it.
 *   2. messages   — record what each shown message body references.
 *   3. comments   — same for task comments.
 *   4. snapshots  — same for every stored Yjs snapshot (documents, task
 *                   descriptions, diagrams, spreadsheets); an action, since
 *                   only actions can read a blob.
 *   5. finalize   — only now, with every scanned source accounted for, mark
 *                   the old rows tracked; those nothing references start the
 *                   grace period and are collected by
 *                   `storageGc.sweepOrphanedMedias` after it.
 *
 * Live writes during the run are safe: since deploy, every owner write keeps
 * its own references (`dbTriggers.ts`, `snapshots.saveSnapshot`), and steps
 * 2–4 restate an owner's references from its current content in one
 * transaction. Re-running the chain is harmless — every step is idempotent.
 *
 * What it cannot see: an upload URL pasted as plain text into a field it does
 * not scan (descriptions on workspaces, projects, cycles, events). Those are
 * links, not embeds; the grace period is the margin for them.
 */

const PAGE_SIZE = 100;
/** Snapshots are whole documents; fewer per action keeps memory bounded. */
const SNAPSHOT_PAGE_SIZE = 25;

const snapshotTable = v.union(
  v.literal("documents"),
  v.literal("tasks"),
  v.literal("diagrams"),
  v.literal("spreadsheets"),
);
type SnapshotTable = "documents" | "tasks" | "diagrams" | "spreadsheets";
const SNAPSHOT_TABLES: readonly SnapshotTable[] = ["documents", "tasks", "diagrams", "spreadsheets"];
const SNAPSHOT_OWNER: Record<SnapshotTable, MediaOwnerType> = {
  documents: "document",
  tasks: "task",
  diagrams: "diagram",
  spreadsheets: "spreadsheet",
};

const cursorArg = v.union(v.string(), v.null());

export const start = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillTokens, { cursor: null });
    return null;
  },
});

/** Step 1: the token each upload's URL carries. */
export const backfillTokens = internalMutation({
  args: { cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("medias").paginate({ numItems: PAGE_SIZE, cursor });
    for (const media of page.page) {
      if (media.token) continue;
      const url = await ctx.storage.getUrl(media.storageId);
      const token = url ? mediaTokenFromUrl(url) : null;
      if (token) await ctx.db.patch(media._id, { token });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillTokens, {
        cursor: page.continueCursor,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillMessageRefs, { cursor: null });
    }
    return null;
  },
});

/** Step 2: references from message bodies. A soft-deleted message shows nothing. */
export const backfillMessageRefs = internalMutation({
  args: { cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("messages").paginate({ numItems: PAGE_SIZE, cursor });
    for (const message of page.page) {
      const tokens = message.deleted ? [] : extractMediaTokens(message.body);
      await syncOwnerRefs(ctx, { type: "message", id: message._id }, tokens);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillMessageRefs, {
        cursor: page.continueCursor,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillCommentRefs, { cursor: null });
    }
    return null;
  },
});

/** Step 3: references from task comment bodies. */
export const backfillCommentRefs = internalMutation({
  args: { cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("taskComments").paginate({ numItems: PAGE_SIZE, cursor });
    for (const comment of page.page) {
      const tokens = comment.deleted ? [] : extractMediaTokens(comment.body);
      await syncOwnerRefs(ctx, { type: "taskComment", id: comment._id }, tokens);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillCommentRefs, {
        cursor: page.continueCursor,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillSnapshotRefs, {
        table: SNAPSHOT_TABLES[0],
        cursor: null,
      });
    }
    return null;
  },
});

/** One page of a collaborative table: each resource's current snapshot blob. */
export const snapshotPage = internalQuery({
  args: { table: snapshotTable, cursor: cursorArg },
  returns: v.object({
    items: v.array(v.object({ id: v.string(), snapshotId: v.id("_storage") })),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { numItems: SNAPSHOT_PAGE_SIZE, cursor };
    // One branch per table: `ctx.db.query` over a union of table names does
    // not narrow to a common document type.
    const page =
      table === "documents"
        ? await ctx.db.query("documents").paginate(opts)
        : table === "tasks"
          ? await ctx.db.query("tasks").paginate(opts)
          : table === "diagrams"
            ? await ctx.db.query("diagrams").paginate(opts)
            : await ctx.db.query("spreadsheets").paginate(opts);
    const items: Array<{ id: string; snapshotId: Id<"_storage"> }> = [];
    for (const row of page.page) {
      if (row.yjsSnapshotId) items.push({ id: row._id, snapshotId: row.yjsSnapshotId });
    }
    return { items, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Step 4: references from stored Yjs snapshots, one table after another. */
export const backfillSnapshotRefs = internalAction({
  args: { table: snapshotTable, cursor: cursorArg },
  returns: v.null(),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.runQuery(internal.mediaBackfill.snapshotPage, { table, cursor });

    const scanned: Array<{ id: string; snapshotId: Id<"_storage">; tokens: string[] }> = [];
    for (const item of page.items) {
      const blob = await ctx.storage.get(item.snapshotId);
      if (!blob) continue;
      const tokens = extractMediaTokens(new TextDecoder().decode(await blob.arrayBuffer()));
      scanned.push({ ...item, tokens });
    }
    if (scanned.length > 0) {
      await ctx.runMutation(internal.mediaBackfill.applySnapshotRefs, { table, scanned });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillSnapshotRefs, {
        table,
        cursor: page.continueCursor,
      });
    } else {
      const next = SNAPSHOT_TABLES[SNAPSHOT_TABLES.indexOf(table) + 1];
      if (next) {
        await ctx.scheduler.runAfter(0, internal.mediaBackfill.backfillSnapshotRefs, {
          table: next,
          cursor: null,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.mediaBackfill.finalizeTracking, {
          cursor: null,
          tracked: 0,
          orphaned: 0,
        });
      }
    }
    return null;
  },
});

/**
 * Apply one page of snapshot scans. A resource whose snapshot changed since
 * the scan is skipped: the save that replaced it has already synced its
 * references from the newer bytes, and the older scan must not overwrite them.
 */
export const applySnapshotRefs = internalMutation({
  args: {
    table: snapshotTable,
    scanned: v.array(
      v.object({ id: v.string(), snapshotId: v.id("_storage"), tokens: v.array(v.string()) }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { table, scanned }) => {
    for (const { id, snapshotId, tokens } of scanned) {
      const resource = await ctx.db.get(id as Id<SnapshotTable>);
      if (!resource || resource.yjsSnapshotId !== snapshotId) continue;
      await syncOwnerRefs(ctx, { type: SNAPSHOT_OWNER[table], id }, tokens);
    }
    return null;
  },
});

/**
 * Step 5: every source is scanned, so an old upload with no reference now is
 * genuinely unreferenced. Mark old rows tracked, stamping the unreferenced
 * ones so the grace period starts. A row without a token stays untracked:
 * nothing could ever reference it, so nothing proves it unused.
 */
export const finalizeTracking = internalMutation({
  args: { cursor: cursorArg, tracked: v.number(), orphaned: v.number() },
  returns: v.null(),
  handler: async (ctx, { cursor, tracked, orphaned }) => {
    const page = await ctx.db.query("medias").paginate({ numItems: PAGE_SIZE, cursor });
    const now = Date.now();
    for (const media of page.page) {
      if (media.tracked || !media.token) continue;
      const ref = await ctx.db
        .query("mediaRefs")
        .withIndex("by_media", (q) => q.eq("mediaId", media._id))
        .first();
      await ctx.db.patch(media._id, { tracked: true, orphanedAt: ref ? undefined : now });
      tracked++;
      if (!ref) orphaned++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.mediaBackfill.finalizeTracking, {
        cursor: page.continueCursor,
        tracked,
        orphaned,
      });
    } else {
      await auditLog.log(ctx, {
        action: "storage.media_tracking_backfilled",
        actorId: "system:media-backfill",
        severity: "info",
        metadata: { resourceName: "Upload references", trackedCount: tracked, orphanedCount: orphaned },
      });
      console.log(`Media backfill complete: tracked=${tracked}, unreferenced=${orphaned}`);
    }
    return null;
  },
});
