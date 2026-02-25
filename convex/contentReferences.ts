import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation, query, mutation } from "./_generated/server";

/**
 * Fetch and enrich references pointing to a target resource.
 * Shared between getReferencesTo query and remove mutations.
 */
export async function getEnrichedReferencesTo(
  ctx: GenericQueryCtx<DataModel>,
  targetId: string,
): Promise<Array<{
  _id: Id<"contentReferences">;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  workspaceId: string;
  projectId?: string;
}>> {
  const refs = await ctx.db
    .query("contentReferences")
    .withIndex("by_target", (q) => q.eq("targetId", targetId))
    .collect();

  return Promise.all(
    refs.map(async (ref) => {
      let sourceName = "Unknown";
      let projectId: string | undefined;
      if (ref.sourceType === "document") {
        const doc = await ctx.db.get(ref.sourceId as Id<"documents">);
        sourceName = doc?.name ?? "Deleted document";
      } else if (ref.sourceType === "task") {
        const task = await ctx.db.get(ref.sourceId as Id<"tasks">);
        sourceName = task?.title ?? "Deleted task";
        projectId = task?.projectId;
      }
      return {
        _id: ref._id,
        sourceType: ref.sourceType as string,
        sourceId: ref.sourceId,
        sourceName,
        workspaceId: ref.workspaceId as string,
        projectId,
      };
    }),
  );
}

/**
 * Sync all hard-embed references for a source (document or task).
 * Called by the client editor on content change (debounced).
 * Diffs against existing rows: deletes removed, inserts added.
 */
export const syncReferences = mutation({
  args: {
    sourceType: v.union(v.literal("document"), v.literal("task")),
    sourceId: v.string(),
    references: v.array(
      v.object({
        targetType: v.union(v.literal("diagram"), v.literal("spreadsheet")),
        targetId: v.string(),
      }),
    ),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, { sourceType, sourceId, references, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Access denied");

    // Get existing refs for this source
    const existing = await ctx.db
      .query("contentReferences")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();

    const existingByTarget = new Map(
      existing.map((r) => [r.targetId, r]),
    );
    const newTargetIds = new Set(references.map((r) => r.targetId));

    // Delete removed
    for (const ref of existing) {
      if (!newTargetIds.has(ref.targetId)) {
        await ctx.db.delete(ref._id);
      }
    }

    // Insert added
    for (const ref of references) {
      if (!existingByTarget.has(ref.targetId)) {
        await ctx.db.insert("contentReferences", {
          sourceType,
          sourceId,
          targetType: ref.targetType,
          targetId: ref.targetId,
          workspaceId,
        });
      }
    }

    return null;
  },
});

/**
 * Remove all outgoing references from a source (when a document/task is deleted).
 */
export const removeAllForSource = internalMutation({
  args: { sourceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const refs = await ctx.db
      .query("contentReferences")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    await Promise.all(refs.map((r) => ctx.db.delete(r._id)));
    return null;
  },
});

/**
 * Remove all incoming references to a target (when a diagram/spreadsheet is deleted).
 */
export const removeAllForTarget = internalMutation({
  args: { targetId: v.string() },
  returns: v.null(),
  handler: async (ctx, { targetId }) => {
    const refs = await ctx.db
      .query("contentReferences")
      .withIndex("by_target", (q) => q.eq("targetId", targetId))
      .collect();
    await Promise.all(refs.map((r) => ctx.db.delete(r._id)));
    return null;
  },
});

/**
 * Get all references pointing to a target resource, enriched with source names.
 * Powers the DeleteWarningDialog.
 */
export const getReferencesTo = query({
  args: { targetId: v.string() },
  returns: v.any(),
  handler: async (ctx, { targetId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return getEnrichedReferencesTo(ctx, targetId);
  },
});
