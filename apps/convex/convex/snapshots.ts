import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getUser } from "./authHelpers";

/**
 * Save a Yjs snapshot to Convex file storage and link it to a resource.
 *
 * This is called by HTTP endpoints after PartyKit POSTs binary Yjs state.
 * The function updates the resource's yjsSnapshotId field and cleans up old snapshots.
 */
export const saveSnapshot = internalMutation({
  args: {
    resourceType: v.union(
      v.literal("doc"),
      v.literal("diagram"),
      v.literal("task"),
      v.literal("spreadsheet")
    ),
    resourceId: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, { resourceType, resourceId, storageId }) => {
    // Get the resource document - cast resourceId to appropriate table type
    let resource;
    if (resourceType === "doc") {
      resource = await ctx.db.get(resourceId as Id<"documents">);
    } else if (resourceType === "diagram") {
      resource = await ctx.db.get(resourceId as Id<"diagrams">);
    } else if (resourceType === "spreadsheet") {
      resource = await ctx.db.get(resourceId as Id<"spreadsheets">);
    } else {
      resource = await ctx.db.get(resourceId as Id<"tasks">);
    }

    if (!resource) {
      console.warn(
        `saveSnapshot: Resource ${resourceType}:${resourceId} not found (may have been deleted). Cleaning up orphaned blob.`
      );
      await ctx.storage.delete(storageId);
      return null;
    }

    // Delete old snapshot if it exists
    if (resource.yjsSnapshotId) {
      try {
        await ctx.storage.delete(resource.yjsSnapshotId);
      } catch (error) {
        console.warn(
          `saveSnapshot: Failed to delete old snapshot ${resource.yjsSnapshotId}:`,
          error
        );
        // Continue anyway - we'll update with the new snapshot
      }
    }

    // Update resource with new snapshot ID
    if (resourceType === "doc") {
      await ctx.db.patch(resourceId as Id<"documents">, {
        yjsSnapshotId: storageId,
      });
    } else if (resourceType === "diagram") {
      await ctx.db.patch(resourceId as Id<"diagrams">, {
        yjsSnapshotId: storageId,
      });
    } else if (resourceType === "spreadsheet") {
      await ctx.db.patch(resourceId as Id<"spreadsheets">, {
        yjsSnapshotId: storageId,
      });
    } else {
      await ctx.db.patch(resourceId as Id<"tasks">, {
        yjsSnapshotId: storageId,
      });
    }

    return null;
  },
});

/**
 * Seed a task's description snapshot *unless the user has already edited it*.
 *
 * Used by the GitHub description seed (see
 * `integrations/core/seedDescriptionAction`). Guarded by the link's
 * `descriptionEdited` flag rather than "snapshot absent": if you open the task
 * before the (scheduled, Node-cold-start) seed lands, the empty PartyKit room
 * may auto-save an *empty* snapshot first. An "if absent" guard would then drop
 * the seed forever. Because an empty auto-save never sets `descriptionEdited`
 * (only a genuine user edit does), this overwrites that empty snapshot with the
 * real seed — while still never clobbering a description the user has touched.
 *
 * Overwriting replaces `yjsSnapshotId` with a *new* storage id, which the client
 * watches (via `taskLinks.getByTask`) to re-hydrate the live doc.
 */
export const seedTaskSnapshot = internalMutation({
  args: { taskId: v.id("tasks"), storageId: v.id("_storage") },
  returns: v.object({ seeded: v.boolean() }),
  handler: async (ctx, { taskId, storageId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      await ctx.storage.delete(storageId);
      return { seeded: false };
    }
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique();
    if (link?.descriptionEdited) {
      // User already engaged with the description — never overwrite it.
      await ctx.storage.delete(storageId);
      await ctx.db.patch(link._id, { seedStatus: "skipped" });
      return { seeded: false };
    }
    // Replace any prior (e.g. empty auto-saved) snapshot; clean up its blob.
    if (task.yjsSnapshotId) {
      try {
        await ctx.storage.delete(task.yjsSnapshotId);
      } catch {
        // Best-effort cleanup; proceed with the new snapshot regardless.
      }
    }
    await ctx.db.patch(taskId, { yjsSnapshotId: storageId });
    if (link) await ctx.db.patch(link._id, { seedStatus: "seeded" });
    return { seeded: true };
  },
});

/**
 * Record a terminal seed outcome on a task's integration link, for the seed
 * paths that don't go through `seedTaskSnapshot` (pre-existing snapshot, empty
 * conversion, or a thrown action). The client's open-time gate watches this to
 * stop waiting deterministically instead of relying on a timeout.
 *
 * No-ops if the link is gone (task deleted mid-seed), and never demotes a
 * terminal `"seeded"` — guards against a retried/re-delivered seed action
 * clobbering a snapshot that already landed.
 */
export const markSeedStatus = internalMutation({
  args: {
    taskId: v.id("tasks"),
    status: v.union(
      v.literal("pending"),
      v.literal("seeded"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, status }) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique();
    if (!link) return null;
    if (link.seedStatus === "seeded") return null;
    await ctx.db.patch(link._id, { seedStatus: status });
    return null;
  },
});

/**
 * Get the Yjs snapshot storage ID for a resource.
 *
 * This is called by HTTP endpoints when PartyKit GETs snapshot data for cold-start hydration.
 */
export const getSnapshot = internalQuery({
  args: {
    resourceType: v.union(
      v.literal("doc"),
      v.literal("diagram"),
      v.literal("task"),
      v.literal("spreadsheet")
    ),
    resourceId: v.string(),
  },
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, { resourceType, resourceId }) => {
    // Get the resource document - cast resourceId to appropriate table type
    let resource;
    if (resourceType === "doc") {
      resource = await ctx.db.get(resourceId as Id<"documents">);
    } else if (resourceType === "diagram") {
      resource = await ctx.db.get(resourceId as Id<"diagrams">);
    } else if (resourceType === "spreadsheet") {
      resource = await ctx.db.get(resourceId as Id<"spreadsheets">);
    } else {
      resource = await ctx.db.get(resourceId as Id<"tasks">);
    }

    if (!resource) {
      return null;
    }

    return resource.yjsSnapshotId ?? null;
  },
});

/**
 * Get the Yjs snapshot download URL for a resource.
 *
 * This is a PUBLIC query that clients can call for cold-start fallback
 * when IndexedDB is empty and PartyKit is unreachable.
 */
export const getSnapshotUrl = query({
  args: {
    resourceType: v.union(
      v.literal("doc"),
      v.literal("diagram"),
      v.literal("task"),
      v.literal("spreadsheet")
    ),
    resourceId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { resourceType, resourceId }) => {
    // Authentication check
    const userId = await getUser(ctx);
    if (!userId) return null;

    // Get the resource document - cast resourceId to appropriate table type
    let resource;
    if (resourceType === "doc") {
      resource = await ctx.db.get(resourceId as Id<"documents">);
    } else if (resourceType === "diagram") {
      resource = await ctx.db.get(resourceId as Id<"diagrams">);
    } else if (resourceType === "spreadsheet") {
      resource = await ctx.db.get(resourceId as Id<"spreadsheets">);
    } else {
      resource = await ctx.db.get(resourceId as Id<"tasks">);
    }

    if (!resource || !resource.yjsSnapshotId) return null;

    // Get the URL for the stored blob
    const url = await ctx.storage.getUrl(resource.yjsSnapshotId);
    return url;
  },
});
