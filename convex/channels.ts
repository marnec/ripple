import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { ChannelRole } from "@shared/enums";
import { stream } from "convex-helpers/server/stream";
import { getAll } from "convex-helpers/server/relationships";
import schema from "./schema";

export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
    isPublic: v.boolean()
  },
  returns: v.id("channels"),
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
  returns: v.array(v.object({
    _id: v.id("channels"),
    _creationTime: v.number(),
    name: v.string(),
    workspaceId: v.id("workspaces"),
    isPublic: v.boolean(),
    roleCount: v.object({
      admin: v.number(),
      member: v.number(),
    }),
  })),
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
  returns: v.union(
    v.object({
      _id: v.id("channels"),
      _creationTime: v.number(),
      name: v.string(),
      workspaceId: v.id("workspaces"),
      isPublic: v.boolean(),
      roleCount: v.object({
        admin: v.number(),
        member: v.number(),
      }),
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const channel = await ctx.db.get(id);
    if (!channel) return null;

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", userId))
      .first();

    if (!membership) return null;

    return channel;
  },
});

export const remove = mutation({
  args: { id: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const channel = await ctx.db.get(id);
    if (!channel) throw new ConvexError("Channel not found");

    // Check if user is a channel admin (for private channels) or workspace admin
    if (!channel.isPublic) {
      const channelMembership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", id).eq("userId", userId))
        .first();

      if (channelMembership?.role !== ChannelRole.ADMIN) {
        throw new ConvexError("Not authorized to delete this channel");
      }
    } else {
      // For public channels, check workspace admin
      const workspaceMembership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", userId))
        .first();

      if (workspaceMembership?.role !== "admin") {
        throw new ConvexError("Not authorized to delete this channel");
      }
    }

    const channelMessages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", id))
      .collect();

    await Promise.all(channelMessages.map((message) => ctx.db.delete(message._id)));

    const channelMembersStream = stream(ctx.db, schema).query("channelMembers").withIndex("by_channel", (q) => q.eq("channelId", id));

    await channelMembersStream.map(async (doc) => {
      await ctx.db.delete(doc._id);
      return null;
    }).collect();

    await ctx.db.delete(id);
    return null;
  },
});

const channelValidator = v.object({
  _id: v.id("channels"),
  _creationTime: v.number(),
  name: v.string(),
  workspaceId: v.id("workspaces"),
  isPublic: v.boolean(),
  roleCount: v.object({
    admin: v.number(),
    member: v.number(),
  }),
});

export const getInternal = internalQuery({
  args: { id: v.id("channels") },
  returns: v.union(channelValidator, v.null()),
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(channelValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) throw new ConvexError("Not authenticated");

    // Get user's private channel memberships in this workspace
    const userMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .collect();

    // Use getAll helper to batch fetch private channels (cleaner than N+1 pattern)
    const privateChannelIds = userMemberships.map((m) => m.channelId);
    const privateChannels = (await getAll(ctx.db, privateChannelIds))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Get public channels in the workspace
    const publicChannels = await ctx.db
      .query("channels")
      .withIndex("by_isPublicInWorkspace", (q) => q.eq("isPublic", true).eq("workspaceId", workspaceId))
      .collect();

    return [...privateChannels, ...publicChannels].sort((a, b) => b._creationTime - a._creationTime);
  },
});


