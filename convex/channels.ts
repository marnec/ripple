import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { ChannelRole } from "@shared/enums";
import { getAll } from "convex-helpers/server/relationships";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { internal } from "./_generated/api";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete } from "./cascadeDelete";
import { requireWorkspaceMember, checkWorkspaceMember, requireChannelAccess } from "./authHelpers";
import { notify } from "./utils/notify";

export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
    isPublic: v.boolean()
  },
  returns: v.id("channels"),
  handler: async (ctx, { name, isPublic, workspaceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const channelId = await db.insert("channels", {
      name,
      workspaceId,
      isPublic,
    });

    if (!isPublic) {
      await db.insert("channelMembers", { channelId, userId, role: ChannelRole.ADMIN, workspaceId });
    }

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: channelId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "channelCreated",
      userId,
      userName: getUserDisplayName(user),
      scope: workspaceId,
      title: `${getUserDisplayName(user)} created a channel`,
      body: name,
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
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

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
    const channel = await ctx.db.get(id);
    if (!channel) return null;
    const auth = await checkWorkspaceMember(ctx, channel.workspaceId);
    if (!auth) return null;
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
    const { userId, channel } = await requireChannelAccess(ctx, id, { role: ChannelRole.ADMIN });

    const updates: { name?: string } = {};
    if (name !== undefined) updates.name = name;

    if (Object.keys(updates).length > 0) {
      if (name !== undefined && name !== channel.name) {
        await logActivity(ctx, {
          userId, resourceType: "channels", resourceId: id,
          action: "renamed", oldValue: channel.name, newValue: name, resourceName: name, scope: channel.workspaceId,
        });
      }
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.patch(id, updates);
    }

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { userId, channel } = await requireChannelAccess(ctx, id, { role: ChannelRole.ADMIN });

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: id,
      action: "deleted", oldValue: channel.name, resourceName: channel.name, scope: channel.workspaceId,
    });

    const user = await ctx.db.get(userId);
    await notify(ctx, {
      category: "channelDeleted",
      userId,
      userName: getUserDisplayName(user),
      scope: channel.workspaceId,
      title: `${getUserDisplayName(user)} deleted a channel`,
      body: channel.name,
      url: `/workspaces/${channel.workspaceId}`,
    });

    await cascadeDelete.deleteWithCascadeBatched(ctx, "channels", id, {
      batchHandlerRef: internal.cascadeDelete._cascadeBatchHandler,
      onComplete: internal.cascadeDelete._batchCascadeOnComplete,
      onCompleteContext: {
        userId, resourceType: "channels", resourceId: id, scope: channel.workspaceId,
      },
    });
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
    await requireWorkspaceMember(ctx, workspaceId);

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
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

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


