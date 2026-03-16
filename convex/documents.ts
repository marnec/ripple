import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_DOC_NAME } from "@shared/constants";
import { auditLog, logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { internal } from "./_generated/api";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  returns: v.id("documents"),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    const documentName = `${DEFAULT_DOC_NAME} ${date} ${time}`;

    const documentId = await ctx.db.insert("documents", {
      workspaceId,
      name: documentName,
    });

    await logActivity(ctx, {
      userId, resourceType: "documents", resourceId: documentId,
      action: "created", newValue: documentName, resourceName: documentName, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId,
      resourceType: "document",
      resourceName: documentName,
      event: "created",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
      url: `/workspaces/${workspaceId}/documents/${documentId}`,
    });

    return documentId;
  },
});

export const rename = mutation({
  args: {
    id: v.id("documents"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", document.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership) {
      throw new ConvexError("You are not a member of this workspace");
    }

    const match = await ctx.db
      .query("documents")
      .withSearchIndex("by_name", (q) =>
        q.search("name", name).eq("workspaceId", document.workspaceId),
      )
      .collect();

    if (match.length) throw new ConvexError("Document name already exists");

    await logActivity(ctx, {
      userId, resourceType: "documents", resourceId: id,
      action: "renamed", oldValue: document.name, newValue: name, resourceName: name, scope: document.workspaceId,
    });

    await ctx.db.patch(id, { name });
    return null;
  },
});

const documentValidator = v.object({
  _id: v.id("documents"),
  _creationTime: v.number(),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  tags: v.optional(v.array(v.string())),
  yjsSnapshotId: v.optional(v.id("_storage")),
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(documentValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return ctx.db
      .query("documents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isFavorite: v.optional(v.boolean()),
  },
  returns: v.array(documentValidator),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("documents")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("documents")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
    }

    if (tags && tags.length > 0) {
      results = results.filter(
        (doc) => doc.tags && tags.every((t) => doc.tags!.includes(t)),
      );
    }

    if (isFavorite !== undefined) {
      const favs = await ctx.db
        .query("favorites")
        .withIndex("by_workspace_user_type", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", "document"),
        )
        .collect();
      const favSet = new Set(favs.map((f) => f.resourceId));
      results = isFavorite
        ? results.filter((doc) => favSet.has(doc._id))
        : results.filter((doc) => !favSet.has(doc._id));
    }

    return results;
  },
});

export const updateTags = mutation({
  args: {
    id: v.id("documents"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);
    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", document.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    await ctx.db.patch(id, { tags });
    return null;
  },
});

export const get = query({
  args: { id: v.id("documents") },
  returns: v.union(documentValidator, v.null()),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);

    if (!document) return null;

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", document.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership) {
      throw new ConvexError("You are not a member of this workspace");
    }

    return document;
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", document.workspaceId).eq("userId", userId),
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not authorized to delete this document");
    }

    // Clean up Yjs snapshot from storage
    if (document.yjsSnapshotId) {
      await ctx.storage.delete(document.yjsSnapshotId);
    }

    await logActivity(ctx, {
      userId, resourceType: "documents", resourceId: id,
      action: "deleted", oldValue: document.name, resourceName: document.name, scope: document.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId: document.workspaceId,
      resourceType: "document",
      resourceName: document.name,
      event: "deleted",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
    });

    // Clean up outgoing content references from this document
    const outgoingRefs = await ctx.db
      .query("contentReferences")
      .withIndex("by_source", (q) => q.eq("sourceId", id))
      .collect();
    await Promise.all(outgoingRefs.map((r) => ctx.db.delete(r._id)));

    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Report new @mentions in a document (called from client-side when editor detects new mentions).
 * Schedules push notifications to mentioned users.
 */
export const reportMention = mutation({
  args: {
    documentId: v.id("documents"),
    mentionedUserIds: v.array(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, mentionedUserIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(documentId);
    if (!document) throw new ConvexError("Document not found");

    // Validate workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", document.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Filter out self-mentions
    const filteredMentions = mentionedUserIds.filter((id) => id !== userId);
    if (filteredMentions.length === 0) return null;

    // Rate limit: check if a document_mention was logged for this document recently
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const recentMentions = await auditLog.queryByActionResource(ctx, {
      action: "documents.document_mention",
      resourceId: documentId,
      limit: 1,
      fromTimestamp: Date.now() - COOLDOWN_MS,
    });

    if (recentMentions.length > 0) return null;

    // Log the mention event for future rate-limit checks
    await logActivity(ctx, {
      userId,
      resourceType: "documents",
      resourceId: documentId,
      action: "document_mention",
      resourceName: document.name,
      newValue: filteredMentions.join(","),
      scope: document.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.documentNotifications.notifyDocumentMention, {
      documentId,
      documentName: document.name,
      workspaceId: document.workspaceId,
      mentionedUserIds: filteredMentions,
      mentionedBy: {
        name: getUserDisplayName(user),
        id: userId,
      },
    });

    return null;
  },
});
