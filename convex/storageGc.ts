import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { auditLog } from "./auditLog";
import type { MutationCtx } from "./_generated/server";

const BATCH_SIZE = 100;
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if a storage ID is referenced by any table.
 * Short-circuits on the first match found.
 */
async function isStorageReferenced(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
): Promise<boolean> {
  // 1. medias (has by_storage_id index)
  const media = await ctx.db
    .query("medias")
    .withIndex("by_storage_id", (q) => q.eq("storageId", storageId))
    .first();
  if (media) return true;

  // 2. documents
  const doc = await ctx.db
    .query("documents")
    .withIndex("by_yjsSnapshotId", (q) => q.eq("yjsSnapshotId", storageId))
    .first();
  if (doc) return true;

  // 3. diagrams
  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_yjsSnapshotId", (q) => q.eq("yjsSnapshotId", storageId))
    .first();
  if (diagram) return true;

  // 4. spreadsheets
  const spreadsheet = await ctx.db
    .query("spreadsheets")
    .withIndex("by_yjsSnapshotId", (q) => q.eq("yjsSnapshotId", storageId))
    .first();
  if (spreadsheet) return true;

  // 5. tasks
  const task = await ctx.db
    .query("tasks")
    .withIndex("by_yjsSnapshotId", (q) => q.eq("yjsSnapshotId", storageId))
    .first();
  if (task) return true;

  return false;
}

/**
 * Run one batch of garbage collection on orphaned storage files.
 * Self-schedules if more pages remain. On completion, logs audit entries
 * per workspace that had orphans cleaned.
 */
export const runGarbageCollection = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    totalDeleted: v.optional(v.number()),
    totalScanned: v.optional(v.number()),
    // Track deleted counts per workspace across batches (JSON string of Record<string, number>)
    workspaceCounts: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const totalDeleted = args.totalDeleted ?? 0;
    const totalScanned = args.totalScanned ?? 0;
    const workspaceCounts: Record<string, number> = args.workspaceCounts
      ? (JSON.parse(args.workspaceCounts) as Record<string, number>)
      : {};

    const cutoffTime = Date.now() - GRACE_PERIOD_MS;

    const result = await ctx.db.system
      .query("_storage")
      .paginate({
        numItems: BATCH_SIZE,
        cursor: args.cursor === null ? undefined : args.cursor,
      });

    let batchDeleted = 0;

    for (const storageDoc of result.page) {
      // Skip recent uploads (grace period for in-flight operations)
      if (storageDoc._creationTime > cutoffTime) continue;

      const storageId = storageDoc._id;
      const referenced = await isStorageReferenced(ctx, storageId);

      if (!referenced) {
        await ctx.storage.delete(storageId);
        batchDeleted++;

        // Try to determine workspace from the medias table (best effort)
        // For truly orphaned files, we won't find a workspace
        // We don't track workspace here since the media record is also gone
        // for true orphans. We'll use a global "unknown" bucket.
        workspaceCounts["_global"] = (workspaceCounts["_global"] ?? 0) + 1;
      }
    }

    const newTotalDeleted = totalDeleted + batchDeleted;
    const newTotalScanned = totalScanned + result.page.length;

    if (!result.isDone) {
      // Schedule next batch
      await ctx.scheduler.runAfter(
        0,
        internal.storageGc.runGarbageCollection,
        {
          cursor: result.continueCursor,
          totalDeleted: newTotalDeleted,
          totalScanned: newTotalScanned,
          workspaceCounts: JSON.stringify(workspaceCounts),
        },
      );
    } else {
      // Final batch — log results
      if (newTotalDeleted > 0) {
        // Log audit entry for each workspace that had orphans
        // For now, all orphans go to _global since we can't determine workspace
        // of already-deleted resources. We log one global audit entry.
        // To make it appear in workspace timelines, we'd need to scope per workspace.
        // Since orphans by definition lack a parent, we log without scope.
        await auditLog.log(ctx, {
          action: "storage.garbage_collected",
          actorId: "system:garbage-collector",
          severity: "info",
          metadata: {
            resourceName: "Storage cleanup",
            deletedCount: newTotalDeleted,
            scannedCount: newTotalScanned,
          },
        });

        console.log(
          `Storage GC complete: scanned=${newTotalScanned}, deleted=${newTotalDeleted}`,
        );
      } else {
        console.log(
          `Storage GC complete: scanned=${newTotalScanned}, no orphans found`,
        );
      }
    }

    return null;
  },
});
