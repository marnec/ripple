import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Get cached block content for a document + block ID pair.
 * Used by the DocumentBlockEmbed render component.
 */
export const getBlockRef = query({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  returns: v.union(
    v.object({
      blockType: v.string(),
      textContent: v.string(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { documentId, blockId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Check workspace membership via document
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", doc.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return null;

    const ref = await ctx.db
      .query("documentBlockRefs")
      .withIndex("by_document_blockId", (q) =>
        q.eq("documentId", documentId).eq("blockId", blockId),
      )
      .unique();

    if (!ref) return null;
    return {
      blockType: ref.blockType,
      textContent: ref.textContent,
      updatedAt: ref.updatedAt,
    };
  },
});

/**
 * Create a placeholder block ref cache entry and schedule snapshot population.
 * Called when a documentBlockEmbed is inserted in the editor.
 */
export const ensureBlockRef = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, blockId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", doc.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Access denied");

    // Check if already exists
    const existing = await ctx.db
      .query("documentBlockRefs")
      .withIndex("by_document_blockId", (q) =>
        q.eq("documentId", documentId).eq("blockId", blockId),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("documentBlockRefs", {
        documentId,
        blockId,
        blockType: "paragraph",
        textContent: "",
        updatedAt: Date.now(),
      });
    }

    // Schedule snapshot read to populate actual content
    await ctx.scheduler.runAfter(0, internal.documentBlockRefsNode.populateFromSnapshot, {
      documentId,
      blockId,
    });

    return null;
  },
});

/**
 * Remove a block ref cache entry. Called when embed is removed from editor.
 */
export const removeBlockRef = mutation({
  args: {
    documentId: v.id("documents"),
    blockId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, blockId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const ref = await ctx.db
      .query("documentBlockRefs")
      .withIndex("by_document_blockId", (q) =>
        q.eq("documentId", documentId).eq("blockId", blockId),
      )
      .unique();

    if (ref) {
      await ctx.db.delete(ref._id);
    }

    return null;
  },
});

/**
 * Batch update block content from PartyKit live push.
 * Only updates existing rows (won't create new ones).
 */
export const upsertBlockContent = internalMutation({
  args: {
    documentId: v.id("documents"),
    updates: v.array(
      v.object({
        blockId: v.string(),
        blockType: v.string(),
        textContent: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, updates }) => {
    const now = Date.now();

    for (const { blockId, blockType, textContent } of updates) {
      const existing = await ctx.db
        .query("documentBlockRefs")
        .withIndex("by_document_blockId", (q) =>
          q.eq("documentId", documentId).eq("blockId", blockId),
        )
        .unique();

      if (existing) {
        // Only update if content actually changed
        if (existing.textContent !== textContent || existing.blockType !== blockType) {
          await ctx.db.patch(existing._id, {
            blockType,
            textContent,
            updatedAt: now,
          });
        }
      }
    }

    return null;
  },
});

/**
 * Get all tracked block IDs for a document.
 * Called by PartyKit (via HTTP) to know which blocks to monitor.
 */
export const getReferencedBlockRefs = internalQuery({
  args: { documentId: v.id("documents") },
  returns: v.array(v.object({ blockId: v.string() })),
  handler: async (ctx, { documentId }) => {
    const refs = await ctx.db
      .query("documentBlockRefs")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();

    return refs.map((ref) => ({ blockId: ref.blockId }));
  },
});

/**
 * Internal query to get a document by ID (used by Node.js actions).
 */
export const getDocumentInternal = internalQuery({
  args: { id: v.id("documents") },
  returns: v.union(
    v.object({
      _id: v.id("documents"),
      _creationTime: v.number(),
      workspaceId: v.id("workspaces"),
      name: v.string(),
      tags: v.optional(v.array(v.string())),
      yjsSnapshotId: v.optional(v.id("_storage")),
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

/**
 * Check if a user is a member of a workspace (used by Node.js actions).
 */
export const checkMembership = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
  },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, userId }) => {
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    return !!membership;
  },
});

/**
 * Remove all block ref cache entries for a document (when document is deleted).
 */
export const removeAllForDocument = internalMutation({
  args: { documentId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, { documentId }) => {
    const refs = await ctx.db
      .query("documentBlockRefs")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    await Promise.all(refs.map((r) => ctx.db.delete(r._id)));
    return null;
  },
});
