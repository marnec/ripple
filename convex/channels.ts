import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ChannelRole } from "@shared/enums";
import { stream, mergedStream } from "convex-helpers/server/stream";
import schema from "./schema";

export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
    isPublic: v.boolean()
  },
  handler: async (ctx, { name, isPublic, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check if user is a member of the workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (!membership) throw new ConvexError("Not a member of this workspace");

    const channelId = await ctx.db.insert("channels", {
      name,
      workspaceId,
      isPublic,
      roleCount: {
        [ChannelRole.MEMBER]: 0,
        [ChannelRole.ADMIN]: 1,
      },
    });

    if (!isPublic) {
      await ctx.db.insert("channelMembers", { channelId, userId, role: ChannelRole.ADMIN, workspaceId });
    }


    return channelId;
  },
});

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Check if user is a member of the workspace
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();

    if (!membership) return [];

    return await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("channels") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: { id: v.id("channels") },
  handler: async (ctx, { id }) => {
    const channelMessages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", id))
      .collect();

    await Promise.all(channelMessages.map((message) => ctx.db.delete(message._id)));

    const channelMembers = stream(ctx.db, schema).query("channelMembers").withIndex("by_channel", (q) => q.eq("channelId", id))

    await channelMembers.map(async (doc) => {
      await ctx.db.delete(doc._id)
      return null
    }).collect()


    await ctx.db.delete(id);
  },
});

export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");


    const userMemberships = stream(ctx.db, schema).query("channelMembers").withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))


    const privateChannels = await userMemberships
      .flatMap(async (membership) => stream(ctx.db, schema)
        .query("channels")
        .withIndex("by_id", q => q.eq("_id", membership.channelId)), ["_id"]
      ).collect()


    const publicChannels = await ctx.db.query("channels").withIndex("by_isPublicInWorkspace", (q) => q.eq("isPublic", true).eq("workspaceId", workspaceId)).collect()

    return [...privateChannels, ...publicChannels].sort((a, b) => b._creationTime - a._creationTime)
  },
});


export const listByUserMembership2 = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");


    const userMemberships = stream(ctx.db, schema).query("channelMembers").withIndex("by_user", (q) => q.eq("userId", userId))


    const privateChannels = userMemberships
      .flatMap(async (membership) => stream(ctx.db, schema)
        .query("channels")
        .withIndex("by_isPublicInWorkspace", q => q.eq("isPublic", false).eq("workspaceId", workspaceId))
        .filterWith(async (q) => q._id === membership.channelId)
        ,
        []
      )

    const publicChannels = stream(ctx.db, schema).query("channels").withIndex("by_isPublicInWorkspace", (q) => q.eq("isPublic", true).eq("workspaceId", workspaceId))

    return mergedStream([privateChannels, publicChannels], [])
  },
});

