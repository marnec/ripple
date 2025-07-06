import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { DocumentRole } from "@shared/enums";
import { documentRoleSchema } from "./schema";
import { internal } from "./_generated/api";

export const membersByDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const members = await ctx.db
      .query("documentMembers")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();

    return Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        if (!user) throw new ConvexError("User not found");
        return { ...member, user };
      }),
    );
  },
});

export const addMember = mutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
  },
  handler: async (ctx, { documentId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(documentId);
    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) =>
        q.eq("documentId", documentId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("You are not an admin of this document");
    }

    const existingMember = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", documentId).eq("userId", userId))
      .first();

    if (existingMember) return;

    await ctx.db.insert("documentMembers", {
      documentId,
      userId,
      role: DocumentRole.MEMBER,
    });

    await ctx.db.patch(documentId, {
      roleCount: {
        ...document.roleCount,
        [DocumentRole.MEMBER]: document.roleCount[DocumentRole.MEMBER] + 1,
      },
    });
  },
});

export const removeMember = mutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
  },
  handler: async (ctx, { documentId, userId }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(documentId);
    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) =>
        q.eq("documentId", documentId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("You are not an admin of this document");
    }

    const memberToRemove = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", documentId).eq("userId", userId))
      .first();

    if (!memberToRemove) return;

    await ctx.db.delete(memberToRemove._id);

    await ctx.db.patch(documentId, {
      roleCount: {
        ...document.roleCount,
        [memberToRemove.role]: document.roleCount[memberToRemove.role] - 1,
      },
    });
  },
});

export const updateRole = mutation({
  args: {
    documentId: v.id("documents"),
    userId: v.id("users"),
    role: documentRoleSchema,
  },
  handler: async (ctx, { documentId, userId, role }) => {
    const actingUserId = await getAuthUserId(ctx);
    if (!actingUserId) throw new ConvexError("Not authenticated");

    const document = await ctx.db.get(documentId);
    if (!document) throw new ConvexError("Document not found");

    const membership = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) =>
        q.eq("documentId", documentId).eq("userId", actingUserId),
      )
      .first();

    if (membership?.role !== DocumentRole.ADMIN) {
      throw new ConvexError("You are not an admin of this document");
    }

    const memberToUpdate = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", documentId).eq("userId", userId))
      .first();

    if (!memberToUpdate) throw new ConvexError("Member not found");

    await ctx.db.patch(memberToUpdate._id, { role });

    await ctx.db.patch(documentId, {
      roleCount: {
        ...document.roleCount,
        [memberToUpdate.role]: document.roleCount[memberToUpdate.role] - 1,
        [role]: document.roleCount[role] + 1,
      },
    });
  },
});

export const leave = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const member = await ctx.db
      .query("documentMembers")
      .withIndex("by_document_user", (q) => q.eq("documentId", documentId).eq("userId", userId))
      .first();

    if (!member) throw new ConvexError("You are not a member of this document");

    const document = await ctx.db.get(documentId);
    if (!document) throw new ConvexError("Document not found");

    if (member.role === DocumentRole.ADMIN && document.roleCount[DocumentRole.ADMIN] === 1) {
      throw new ConvexError("Cannot leave as the only admin");
    }
    await ctx.db.delete(member._id);

    await ctx.db.patch(documentId, {
      roleCount: {
        ...document.roleCount,
        [member.role]: document.roleCount[member.role] - 1,
      },
    });
  },
}); 