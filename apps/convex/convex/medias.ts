import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { checkWorkspaceMember, requireUser, requireWorkspaceMember } from "./authHelpers";
import { MESSAGE_FILE_ATTACHMENT_MAX_BYTES, formatFileSize } from "@ripple/shared/constants";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);

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
    type: v.union(v.literal("image"), v.literal("file")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);

    // `args.size` is the client's word for it; the storage row is the fact, so
    // that is what the cap is read off — a client under-reporting `size` would
    // otherwise walk straight past the check.
    //
    // The refused blob is deliberately NOT deleted here. A mutation is one
    // transaction: a `ctx.storage.delete` followed by a throw is rolled back
    // with everything else, so the call would be pure noise. What actually
    // collects it is `storageGc` — no `medias` row ends up referring to it, so
    // it is an orphan by construction and gets swept after the grace period.
    if (args.type === "file") {
      const stored = await ctx.db.system.get(args.storageId);
      const actualSize = stored?.size ?? args.size;
      if (actualSize > MESSAGE_FILE_ATTACHMENT_MAX_BYTES) {
        throw new ConvexError(
          `File is too large (max ${formatFileSize(MESSAGE_FILE_ATTACHMENT_MAX_BYTES)})`,
        );
      }
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
    // A Convex storage URL needs no further auth, so the return value IS a
    // bearer capability to the bytes — `requireUser` alone made every uploaded
    // image readable across workspaces. Resolve the owning `medias` row (it
    // carries workspaceId, written by `saveMedia`) and apply the workspace
    // rule, the same shape `snapshots.getSnapshotUrl` uses.
    const media = await ctx.db
      .query("medias")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId))
      .first();
    if (!media) return null;

    const access = await checkWorkspaceMember(ctx, media.workspaceId);
    if (!access) return null;

    return await ctx.storage.getUrl(args.storageId);
  },
});
