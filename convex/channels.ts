import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { ChannelRole, ChannelType } from "@shared/enums";
import { getAll } from "convex-helpers/server/relationships";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@shared/displayName";
import { internal } from "./_generated/api";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete } from "./cascadeDelete";
import { requireWorkspaceMember, checkWorkspaceMember, requireChannelAccess } from "./authHelpers";
import { notify } from "./utils/notify";
import { channelTypeSchema } from "./schema";
import type { Doc } from "./_generated/dataModel";

/**
 * Normalize a channel doc to guarantee `type` is set, falling back from legacy `isPublic`.
 *
 * TODO(channel-type-migration): delete this helper and all its call sites after
 * running `migrations:migrateChannelIsPublicToType` in prod and making `type`
 * required in schema.ts. Until then, any read of `channel.type` must funnel
 * through this helper because prod data still has `isPublic` without `type`.
 */
function normalizeChannel<T extends Doc<"channels">>(channel: T): T & { type: "open" | "closed" | "dm" } {
  if (channel.type !== undefined) return channel as T & { type: "open" | "closed" | "dm" };
  const legacy = channel as Record<string, unknown>;
  const isPublic = legacy.isPublic as boolean | undefined;
  return { ...channel, type: isPublic === false ? "closed" as const : "open" as const };
}

export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
    type: channelTypeSchema,
  },
  returns: v.id("channels"),
  handler: async (ctx, { name, type, workspaceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const channelId = await db.insert("channels", {
      name,
      workspaceId,
      type,
    });

    if (type !== ChannelType.OPEN) {
      const creator = await ctx.db.get(userId);
      await db.insert("channelMembers", {
        channelId,
        userId,
        role: ChannelRole.ADMIN,
        workspaceId,
        email: creator?.email,
        name: creator ? getUserDisplayName(creator) : undefined,
      });
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
    type: channelTypeSchema,
  })),
  handler: async (ctx, { workspaceId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    const channels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return channels.map(normalizeChannel).map((c) => ({
      _id: c._id,
      _creationTime: c._creationTime,
      name: c.name,
      workspaceId: c.workspaceId,
      type: c.type,
    }));
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
      type: channelTypeSchema,
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    const channel = await ctx.db.get(id);
    if (!channel) return null;
    const auth = await checkWorkspaceMember(ctx, channel.workspaceId);
    if (!auth) return null;
    const n = normalizeChannel(channel);
    return {
      _id: n._id,
      _creationTime: n._creationTime,
      name: n.name,
      workspaceId: n.workspaceId,
      type: n.type,
    };
  },
});

export const update = mutation({
  args: {
    id: v.id("channels"),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name }) => {
    // Check DM guard before requiring admin role
    const channelDoc = await ctx.db.get(id);
    if (channelDoc?.type === "dm") {
      throw new ConvexError("Cannot rename a DM");
    }

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
    type: v.optional(channelTypeSchema),
  },
  returns: v.array(v.object({ _id: v.id("channels"), name: v.string(), type: channelTypeSchema })),
  handler: async (ctx, { workspaceId, searchText, type }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    let results;
    if (searchText?.trim()) {
      results = await ctx.db
        .query("channels")
        .withSearchIndex("by_name", (q) => {
          const base = q.search("name", searchText).eq("workspaceId", workspaceId);
          return type !== undefined ? base.eq("type", type) : base;
        })
        .collect();
    } else if (type !== undefined) {
      results = await ctx.db
        .query("channels")
        .withIndex("by_type_workspace", (q) =>
          q.eq("type", type).eq("workspaceId", workspaceId),
        )
        .collect();
    } else {
      results = await ctx.db
        .query("channels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
    }

    return results.map(normalizeChannel).map((c) => ({
      _id: c._id,
      name: c.name,
      type: c.type,
    }));
  },
});

const channelValidator = v.object({
  _id: v.id("channels"),
  _creationTime: v.number(),
  name: v.string(),
  workspaceId: v.id("workspaces"),
  type: channelTypeSchema,
});

export const getInternal = internalQuery({
  args: { id: v.id("channels") },
  returns: v.union(channelValidator, v.null()),
  handler: async (ctx, { id }) => {
    const channel = await ctx.db.get(id);
    if (!channel) return null;
    const n = normalizeChannel(channel);
    return {
      _id: n._id,
      _creationTime: n._creationTime,
      name: n.name,
      workspaceId: n.workspaceId,
      type: n.type,
    };
  },
});

export const listByUserMembership = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(channelValidator),
  handler: async (ctx, { workspaceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Get user's closed/dm channel memberships in this workspace
    const userMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .collect();

    // Use getAll helper to batch fetch closed/dm channels
    const memberChannelIds = userMemberships.map((m) => m.channelId);
    const memberChannels = (await getAll(ctx.db, memberChannelIds))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Get open channels in the workspace
    const openChannels = await ctx.db
      .query("channels")
      .withIndex("by_type_workspace", (q) => q.eq("type", ChannelType.OPEN).eq("workspaceId", workspaceId))
      .collect();

    return [...memberChannels, ...openChannels]
      .map(normalizeChannel)
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((c) => ({
        _id: c._id,
        _creationTime: c._creationTime,
        name: c.name,
        workspaceId: c.workspaceId,
        type: c.type,
      }));
  },
});

export const createDm = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    otherUserId: v.id("users"),
  },
  returns: v.id("channels"),
  handler: async (ctx, { workspaceId, otherUserId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    if (userId === otherUserId) {
      throw new ConvexError("Cannot create a DM with yourself");
    }

    // Verify other user is in the workspace
    const otherMembership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", otherUserId),
      )
      .first();
    if (!otherMembership) {
      throw new ConvexError("User is not a member of this workspace");
    }

    // Deduplicate: find existing DM between these two users. Match by userId
    // first, then fall back to the denormalized email on channelMembers — this
    // covers the case where the other user's row was replaced (account
    // deletion + re-signup with the same email). On email match we patch the
    // stale row to the current userId so subsequent lookups are fast.
    const callerUser = await ctx.db.get(userId);
    const otherUser = await ctx.db.get(otherUserId);
    const otherEmail = otherUser?.email;

    const myChannelMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .collect();

    for (const cm of myChannelMemberships) {
      const channel = await ctx.db.get(cm.channelId);
      if (channel?.type !== "dm") continue;

      const allMembers = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", cm.channelId))
        .collect();

      for (const m of allMembers) {
        if (m.userId === userId) continue;
        if (m.userId === otherUserId) return cm.channelId;
        if (otherEmail && m.email === otherEmail) {
          // Reinstate: point the stale membership at the current userId
          await ctx.db.patch(m._id, { userId: otherUserId });
          return cm.channelId;
        }
      }
    }

    // No existing DM — create one. Auto-generate a stable name from both
    // participants' display names (sorted so both parties see the same label).
    // This is a snapshot — if a user later changes their display name the DM
    // label won't auto-update, but the sidebar falls back to dynamic resolution
    // if `name` is empty (see workspaceSidebarData.ts).
    const callerName = callerUser ? getUserDisplayName(callerUser) : "Unknown";
    const otherName = otherUser ? getUserDisplayName(otherUser) : "Unknown";
    const [first, second] = [callerName, otherName].sort();
    const dmName = `${first} × ${second}`;

    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const channelId = await db.insert("channels", {
      name: dmName,
      workspaceId,
      type: ChannelType.DM,
    });

    await db.insert("channelMembers", {
      channelId,
      userId,
      role: ChannelRole.MEMBER,
      workspaceId,
      email: callerUser?.email,
      name: callerName,
    });

    await db.insert("channelMembers", {
      channelId,
      userId: otherUserId,
      role: ChannelRole.MEMBER,
      workspaceId,
      email: otherEmail,
      name: otherName,
    });

    return channelId;
  },
});

export const getAccessInfo = query({
  args: { channelId: v.id("channels") },
  returns: v.union(
    v.object({
      isMember: v.literal(true),
    }),
    v.object({
      isMember: v.literal(false),
      type: v.literal("closed"),
      name: v.string(),
      memberCount: v.number(),
      description: v.optional(v.string()),
    }),
    v.object({
      isMember: v.literal(false),
      type: v.literal("dm"),
      participants: v.array(v.object({
        userId: v.id("users"),
        name: v.string(),
      })),
    }),
    v.null(),
  ),
  handler: async (ctx, { channelId }) => {
    const rawChannel = await ctx.db.get(channelId);
    if (!rawChannel) return null;
    const channel = normalizeChannel(rawChannel);

    const auth = await checkWorkspaceMember(ctx, channel.workspaceId);
    if (!auth) return null;

    // Open channels: everyone is a member
    if (channel.type === "open") return { isMember: true as const };

    // Check explicit channel membership
    const channelMembership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", auth.userId),
      )
      .first();

    if (channelMembership) return { isMember: true as const };

    // DM non-member: DM existence is public, so return participant info so the
    // frontend can show a "you're not in this conversation" gate (not a 404).
    if (channel.type === "dm") {
      const dmMembers = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
      const participants = await Promise.all(
        dmMembers.map(async (m) => {
          const user = await ctx.db.get(m.userId);
          return {
            userId: m.userId,
            name: user ? getUserDisplayName(user) : (m.email ?? "Unknown"),
          };
        }),
      );
      return { isMember: false as const, type: "dm" as const, participants };
    }

    // Closed channel non-member: return limited info for the ask-to-join flow
    const memberCount = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect()
      .then((m) => m.length);

    return {
      isMember: false as const,
      type: "closed" as const,
      name: channel.name,
      memberCount,
    };
  },
});

export const requestJoin = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (channel.type === "open") throw new ConvexError("Channel is open — just join");
    if (channel.type === "dm") throw new ConvexError("Cannot request to join a DM");

    const { userId } = await requireWorkspaceMember(ctx, channel.workspaceId);

    // Check not already a member
    const existing = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();
    if (existing) throw new ConvexError("Already a member of this channel");

    // Notify channel admins
    const user = await ctx.db.get(userId);
    const channelAdmins = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_role", (q) =>
        q.eq("channelId", channelId).eq("role", "admin"),
      )
      .collect();

    await notify(ctx, {
      category: "channelCreated",
      userId,
      userName: getUserDisplayName(user),
      recipientIds: channelAdmins.map((a) => a.userId),
      title: `${getUserDisplayName(user)} wants to join #${channel.name}`,
      body: "Go to channel settings to add them.",
      url: `/workspaces/${channel.workspaceId}/channels/${channelId}/settings`,
    });

    return null;
  },
});

export const findDm = query({
  args: {
    workspaceId: v.id("workspaces"),
    otherUserId: v.id("users"),
  },
  returns: v.union(v.id("channels"), v.null()),
  handler: async (ctx, { workspaceId, otherUserId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return null;

    const otherUser = await ctx.db.get(otherUserId);
    const otherEmail = otherUser?.email;

    const myChannelMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", auth.userId),
      )
      .collect();

    for (const cm of myChannelMemberships) {
      const channel = await ctx.db.get(cm.channelId);
      if (channel?.type !== "dm") continue;

      const allMembers = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", cm.channelId))
        .collect();

      for (const m of allMembers) {
        if (m.userId === auth.userId) continue;
        if (m.userId === otherUserId) return cm.channelId;
        if (otherEmail && m.email === otherEmail) return cm.channelId;
      }
    }

    return null;
  },
});


