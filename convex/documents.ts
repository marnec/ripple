import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DEFAULT_DOC_NAME } from "@shared/constants";
import { DocumentRole } from "@shared/enums";
import { getAll } from "convex-helpers/server/relationships";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
  },
  returns: v.id("documents"),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const match = await ctx.db
      .query("documents")
      .withSearchIndex("by_name", (q) =>
        q.search("name", DEFAULT_DOC_NAME).eq("workspaceId", workspaceId),
      )
      .collect();

    const lastUntitledCount =
      match
        .map(({ name }) => parseInt(name.split("_").at(1) || ""))
        .filter(Boolean)
        .sort((a, b) => b - a)
        .at(0) || 0;

    const documentId = await ctx.db.insert("documents", {
      workspaceId,
      name: `${DEFAULT_DOC_NAME}_${lastUntitledCount + 1}`,
      roleCount: {
        [DocumentRole.ADMIN]: 1,
        [DocumentRole.MEMBER]: 0,
      },
    });

    await ctx.db.insert("documentMembers", {
      documentId,
      userId,
      role: DocumentRole.ADMIN,
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

    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", id).eq("userId", userId))
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("You are not an admin of this document");
    }

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

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
  roleCount: v.object({
    admin: v.number(),
    member: v.number(),
  }),
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

export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(documentValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const documentMembers = await ctx.db
      .query("documentMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const documentIds = documentMembers.map((m) => m.documentId);

    // Use getAll helper to batch fetch documents
    const documents = await getAll(ctx.db, documentIds);

    return documents
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .filter((document) => document.workspaceId === workspaceId);
  },
});

export const get = query({
  args: { id: v.id("documents") },
  returns: documentValidator,
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", id).eq("userId", userId))
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("You are not an admin of this document");
    }

    const document = await ctx.db.get(id);

    if (!document) throw new ConvexError("Document not found");

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

    // Check if user is admin of this document
    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", id).eq("userId", userId))
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("Not authorized to delete this document");
    }

    // Clean up all document members
    const documentMembers = await ctx.db
      .query("documentMembers")
      .withIndex("by_document", (q) => q.eq("documentId", id))
      .collect();

    await Promise.all(documentMembers.map((member) => ctx.db.delete(member._id)));

    await ctx.db.delete(id);
    return null;
  },
});
