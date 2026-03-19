import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { ChannelRole } from "@shared/enums";
import { stream } from "convex-helpers/server/stream";
import { getAll } from "convex-helpers/server/relationships";
import schema from "./schema";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { internal } from "./_generated/api";
import { triggers } from "./workspaceAggregates";
import { writerWithTriggers } from "convex-helpers/server/triggers";

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

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const channelId = await db.insert("channels", {
      name,
      workspaceId,
      isPublic,
    });

    if (!isPublic) {
      await ctx.db.insert("channelMembers", { channelId, userId, role: ChannelRole.ADMIN, workspaceId });
    }

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: channelId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId,
      resourceType: "channel",
      resourceName: name,
      event: "created",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
      url: `/workspaces/${workspaceId}/channels/${channelId}`,
    });

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

export const update = mutation({
  args: {
    id: v.id("channels"),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const channel = await ctx.db.get(id);
    if (!channel) throw new ConvexError("Channel not found");

    // For private channels, require channel admin
    if (!channel.isPublic) {
      const channelMembership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", id).eq("userId", userId))
        .first();

      if (channelMembership?.role !== ChannelRole.ADMIN) {
        throw new ConvexError("Not authorized to update this channel");
      }
    } else {
      // For public channels, require workspace admin
      const workspaceMembership = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", channel.workspaceId).eq("userId", userId))
        .first();

      if (workspaceMembership?.role !== "admin") {
        throw new ConvexError("Not authorized to update this channel");
      }
    }

    const updates: { name?: string } = {};
    if (name !== undefined) updates.name = name;

    if (Object.keys(updates).length > 0) {
      if (name !== undefined && name !== channel.name) {
        await logActivity(ctx, {
          userId, resourceType: "channels", resourceId: id,
          action: "renamed", oldValue: channel.name, newValue: name, resourceName: name, scope: channel.workspaceId,
        });
      }
      await ctx.db.patch(id, updates);
    }

    return null;
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

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: id,
      action: "deleted", oldValue: channel.name, resourceName: channel.name, scope: channel.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.resourceNotifications.notifyResourceEvent, {
      workspaceId: channel.workspaceId,
      resourceType: "channel",
      resourceName: channel.name,
      event: "deleted",
      triggeredBy: { name: getUserDisplayName(user), id: userId },
    });

    const channelMessages = await ctx.db
      .query("messages")
      .withIndex("by_channel", (q) => q.eq("channelId", id))
      .collect();

    // Clean up edges for all messages in this channel, then delete messages
    for (const message of channelMessages) {
      const messageEdges = await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", message._id))
        .collect();
      await Promise.all(messageEdges.map((e) => ctx.db.delete(e._id)));
    }
    await Promise.all(channelMessages.map((message) => ctx.db.delete(message._id)));

    const channelMembersStream = stream(ctx.db, schema).query("channelMembers").withIndex("by_channel", (q) => q.eq("channelId", id));

    await channelMembersStream.map(async (doc) => {
      await ctx.db.delete(doc._id);
      return null;
    }).collect();

    // Delete channel notification preferences
    const chanNotifPrefs = await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_channel", (q) => q.eq("channelId", id))
      .collect();
    await Promise.all(chanNotifPrefs.map((p) => ctx.db.delete(p._id)));

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    await db.delete(id);
    return null;
  },
});

export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.array(v.object({ _id: v.id("channels"), name: v.string(), isPublic: v.boolean() })),
  handler: async (ctx, { workspaceId, searchText, isPublic }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();
    if (!membership) return [];

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("channels")
        .withSearchIndex("by_name", (q) => {
          const base = q.search("name", searchText).eq("workspaceId", workspaceId);
          return isPublic !== undefined ? base.eq("isPublic", isPublic) : base;
        })
        .collect();
    } else if (isPublic !== undefined) {
      results = await ctx.db
        .query("channels")
        .withIndex("by_isPublicInWorkspace", (q) =>
          q.eq("isPublic", isPublic).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("channels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
    }

    return results.map((c) => ({
      _id: c._id,
      name: c.name,
      isPublic: c.isPublic,
    }));
  },
});

const channelValidator = v.object({
  _id: v.id("channels"),
  _creationTime: v.number(),
  name: v.string(),
  workspaceId: v.id("workspaces"),
  isPublic: v.boolean(),
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


