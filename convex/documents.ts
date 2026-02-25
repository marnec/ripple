import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_DOC_NAME } from "@shared/constants";

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

export const get = query({
  args: { id: v.id("documents") },
  returns: documentValidator,
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
