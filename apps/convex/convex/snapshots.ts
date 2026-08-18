import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  collabResourceValidator,
  getUser,
  hasResourceAccess,
  type CollabResource,
} from "./authHelpers";

/**
 * Tables that carry a `yjsSnapshotId`. Narrowing the id to this union (rather
 * than branching per type at each call site) lets one `ctx.db.get` serve every
 * room kind: the field is common to all four, so the union of docs still has it.
 */
type SnapshotTable = "documents" | "diagrams" | "spreadsheets" | "tasks";

/** The resource id as it arrives on the wire — a string — typed for its table. */
function snapshotId(resourceId: string): Id<SnapshotTable> {
  return resourceId as Id<SnapshotTable>;
}

/**
 * Save a Yjs snapshot to Convex file storage and link it to a resource.
 *
 * This is called by HTTP endpoints after PartyKit POSTs binary Yjs state.
 * The function updates the resource's yjsSnapshotId field and cleans up old snapshots.
 */
export const saveSnapshot = internalMutation({
  args: {
    resourceType: collabResourceValidator,
    resourceId: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, { resourceType, resourceId, storageId }) => {
    const resource = await ctx.db.get(snapshotId(resourceId));

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
    await ctx.db.patch(snapshotId(resourceId), { yjsSnapshotId: storageId });

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
    resourceType: collabResourceValidator,
    resourceId: v.string(),
  },
  returns: v.union(v.id("_storage"), v.null()),
  handler: async (ctx, { resourceId }) => {
    const resource = await ctx.db.get(snapshotId(resourceId));
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
 *
 * Access must match the collaboration-token path (`collaboration.checkAccess`),
 * because this returns the same Yjs state that path guards: a signed URL to the
 * resource's full snapshot. Authentication alone is not enough — without the
 * membership check any signed-in user could read another workspace's documents
 * from an id alone. Denial returns null rather than throwing, matching the
 * existing not-signed-in contract that callers treat as "no snapshot".
 */
export const getSnapshotUrl = query({
  args: {
    resourceType: collabResourceValidator,
    resourceId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { resourceType, resourceId }) => {
    const stored = await resolveStoredState(ctx, resourceType, resourceId);
    return stored.status === "stored" ? stored.url : null;
  },
});

/**
 * The same question as `getSnapshotUrl`, asked so that the answer distinguishes
 * "there is nothing stored" from "you may not ask".
 *
 * `getSnapshotUrl` collapses both into `null`, which is right for the callers
 * that only want to download something and can do nothing either way. The
 * cold-start path needs more: a resource whose snapshot has *never* been
 * written is one nobody has ever put content into, so the client may treat it
 * as genuinely empty and let the user work in it offline. Reading that from a
 * bare null would mean a caller who has lost access bootstraps a document they
 * cannot sync, and merges a competing root into it later — see
 * `apps/web/src/lib/collab/empty-document.ts`.
 *
 * "Never written" is a safe thing to say precisely because every client that
 * opens an empty document writes the canonical empty root into it, so a room
 * anyone has ever synced has a snapshot.
 */
export const getStoredState = query({
  args: {
    resourceType: collabResourceValidator,
    resourceId: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("stored"), url: v.string() }),
    v.object({ status: v.literal("empty") }),
    v.object({ status: v.literal("unavailable") }),
  ),
  handler: async (ctx, { resourceType, resourceId }) => {
    return await resolveStoredState(ctx, resourceType, resourceId);
  },
});

/**
 * What is persisted for a resource, and whether the caller may have it.
 *
 * Shared by both public queries so the authorization rule — the collaboration
 * rule, `hasResourceAccess`, the same one the token path and the room use —
 * exists once. A second copy is how one of the three doors to a document's
 * bytes ends up unlocked.
 */
async function resolveStoredState(
  ctx: QueryCtx,
  resourceType: CollabResource,
  resourceId: string,
): Promise<
  { status: "stored"; url: string } | { status: "empty" } | { status: "unavailable" }
> {
  const userId = await getUser(ctx);
  if (!userId) return { status: "unavailable" };

  const allowed = await hasResourceAccess(ctx, userId, resourceType, resourceId);
  if (!allowed) return { status: "unavailable" };

  const resource = await ctx.db.get(snapshotId(resourceId));
  // A resource that is gone is not an empty one: the caller must not conclude
  // anything about its contents.
  if (!resource) return { status: "unavailable" };

  if (!resource.yjsSnapshotId) return { status: "empty" };

  const url = await ctx.storage.getUrl(resource.yjsSnapshotId);
  // A snapshot id pointing at a blob that is not there is a broken snapshot,
  // not an empty document.
  if (!url) return { status: "unavailable" };

  return { status: "stored", url };
}
