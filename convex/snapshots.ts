import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

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
      v.literal("task")
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
    } else {
      resource = await ctx.db.get(resourceId as Id<"tasks">);
    }

    if (!resource) {
      console.warn(
        `saveSnapshot: Resource ${resourceType}:${resourceId} not found (may have been deleted)`
      );
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
    } else {
      await ctx.db.patch(resourceId as Id<"tasks">, {
        yjsSnapshotId: storageId,
      });
    }

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
      v.literal("task")
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
      v.literal("task")
    ),
    resourceId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { resourceType, resourceId }) => {
    // Authentication check
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Get the resource document - cast resourceId to appropriate table type
    let resource;
    if (resourceType === "doc") {
      resource = await ctx.db.get(resourceId as Id<"documents">);
    } else if (resourceType === "diagram") {
      resource = await ctx.db.get(resourceId as Id<"diagrams">);
    } else {
      resource = await ctx.db.get(resourceId as Id<"tasks">);
    }

    if (!resource || !resource.yjsSnapshotId) return null;

    // Get the URL for the stored blob
    const url = await ctx.storage.getUrl(resource.yjsSnapshotId);
    return url;
  },
});
