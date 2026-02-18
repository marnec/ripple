import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return await ctx.storage.generateUploadUrl();
  },
});

export const saveMedia = mutation({
  args: {
    storageId: v.id("_storage"),
    workspaceId: v.id("workspaces"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    type: v.union(v.literal("image")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this workspace");
    }

    await ctx.db.insert("medias", {
      storageId: args.storageId,
      workspaceId: args.workspaceId,
      uploadedBy: userId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      size: args.size,
      type: args.type,
    });

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new ConvexError("Failed to get URL for uploaded file");

    return url;
  },
});

export const getUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return await ctx.storage.getUrl(args.storageId);
  },
});
