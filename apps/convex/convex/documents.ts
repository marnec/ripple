import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { DEFAULT_DOC_NAME } from "@ripple/shared/constants";
import { auditLog, logActivity } from "./auditLog";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";
import { requireResourceMember, requireWorkspaceMember, checkResourceMember } from "./authHelpers";
import { syncTagsForResource } from "./tagSync";
import { searchResourcesByTag, searchResourcesByFavorite } from "./resourceSearch";
import { notify } from "./utils/notify";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
  },
  returns: v.id("documents"),
  handler: async (ctx, { workspaceId, name }) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    let documentName: string;
    if (name) {
      documentName = name;
    } else {
      const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })
      const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      documentName = `${DEFAULT_DOC_NAME} ${date} ${time}`;
    }

    const documentId = await db.insert("documents", {
      workspaceId,
      name: documentName,
    });

    await logActivity(ctx, {
      userId, resourceType: "documents", resourceId: documentId,
      action: "created", newValue: documentName, resourceName: documentName, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "documentCreated",
      userId,
      userName: getUserDisplayName(user),
      scope: workspaceId,
      title: `${getUserDisplayName(user)} created a document`,
      body: documentName,
      url: `/workspaces/${workspaceId}/documents/${documentId}`,
    });

    return documentId;
  },
});

/**
 * System-created document, used by the call-transcript webhook ingest (which
 * runs with no authenticated user). Mirrors `create`'s insert but skips the
 * auth check, activity log, and notification — the transcript action owns
 * naming and the subsequent snapshot seed. Still goes through
 * `writerWithTriggers` so denormalised indexes (tags etc.) stay consistent.
 */
export const createForTranscript = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    channelId: v.id("channels"),
  },
  returns: v.id("documents"),
  handler: async (ctx, { workspaceId, name, channelId }) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    // `transcript` tag (not the name) marks these docs. The denormalized
    // `tags` column drives the doc's own display + the graph `nodes.tags`
    // (via dbTriggers); `syncTagsForResource` reconciles the `entityTags`
    // join + workspace `tags` dictionary, reusing a preexisting `transcript`
    // tag rather than creating a duplicate (get-or-create on by_workspace_name).
    const documentId = await db.insert("documents", {
      workspaceId,
      name,
      tags: ["transcript"],
    });
    await syncTagsForResource(ctx, {
      workspaceId,
      resourceType: "document",
      resourceId: documentId,
      nextTagNames: ["transcript"],
    });

    // Graph edge: document --transcript_of--> channel (mirrors the
    // calendarEvent--hosted_in-->channel convention). The document's `nodes`
    // row was just created by the documents insert-trigger above; the channel's
    // node already exists. Cascades away when either side is deleted (cascade
    // rules cover edges by_source/by_target on both documents and channels).
    const [docNode, channelNode] = await Promise.all([
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", documentId))
        .first(),
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", channelId))
        .first(),
    ]);
    await ctx.db.insert("edges", {
      sourceType: "document",
      sourceId: documentId,
      targetType: "channel",
      targetId: channelId,
      edgeType: "transcript_of",
      workspaceId,
      sourceNodeId: docNode?._id,
      targetNodeId: channelNode?._id,
      createdAt: Date.now(),
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
    const { userId, resource: document } = await requireResourceMember(ctx, "documents", id);

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

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { name });
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
    await requireWorkspaceMember(ctx, workspaceId);

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
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(documentValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, tags, isFavorite, paginationOpts }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Precedence: text search > tag filter > favorites-on > default. Each
    // branch returns a complete PaginationResult; they do not compose.
    if (searchText?.trim()) {
      return await ctx.db
        .query("documents")
        .withSearchIndex("by_name", (q) =>
          q.search("name", searchText).eq("workspaceId", workspaceId),
        )
        .paginate(paginationOpts);
    }

    if (tags && tags.length > 0) {
      return await searchResourcesByTag(ctx, {
        workspaceId,
        resourceType: "document",
        tags,
        paginationOpts,
      });
    }

    if (isFavorite === true) {
      return await searchResourcesByFavorite(ctx, {
        workspaceId,
        userId,
        resourceType: "document",
        paginationOpts,
      });
    }

    return await ctx.db
      .query("documents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .paginate(paginationOpts);
  },
});

export const updateTags = mutation({
  args: {
    id: v.id("documents"),
    tags: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, tags }) => {
    const { resource } = await requireResourceMember(ctx, "documents", id);
    const normalized = await syncTagsForResource(ctx, {
      workspaceId: resource.workspaceId,
      resourceType: "document",
      resourceId: id,
      nextTagNames: tags,
    });

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.patch(id, { tags: normalized });
    return null;
  },
});

export const get = query({
  args: { id: v.id("documents") },
  returns: v.union(documentValidator, v.null()),
  handler: async (ctx, { id }) => {
    const result = await checkResourceMember(ctx, "documents", id);
    if (!result) return null;
    return result.resource;
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { userId, resource: document } = await requireResourceMember(ctx, "documents", id);

    await logActivity(ctx, {
      userId, resourceType: "documents", resourceId: id,
      action: "deleted", oldValue: document.name, resourceName: document.name, scope: document.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "documentDeleted",
      userId,
      userName: getUserDisplayName(user),
      scope: document.workspaceId,
      title: `${getUserDisplayName(user)} deleted a document`,
      body: document.name,
      url: `/workspaces/${document.workspaceId}`,
    });

    await cascadeDelete.deleteWithCascade(ctx, "documents", id, {
      onComplete: logCascadeSummary({
        userId, resourceType: "documents", resourceId: id, scope: document.workspaceId,
      }),
    });
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
    const { userId, resource: document } = await requireResourceMember(ctx, "documents", documentId);

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
    await notify(ctx, {
      category: "documentMention",
      userId,
      userName: getUserDisplayName(user),
      recipientIds: filteredMentions,
      title: `${getUserDisplayName(user)} mentioned you`,
      body: document.name,
      url: `/workspaces/${document.workspaceId}/documents/${documentId}`,
    });

    return null;
  },
});
