import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { ChannelRole, ChannelType } from "@ripple/shared/enums";
import { getAll } from "convex-helpers/server/relationships";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { internal } from "./_generated/api";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete } from "./cascadeDelete";
import { requireWorkspaceMember, checkWorkspaceMember, requireChannelAccess, requireUser } from "./authHelpers";
import { notify } from "./utils/notify";
import { channelTypeSchema } from "./schema";
import type { Doc } from "./_generated/dataModel";

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
    return channels.map((c) => ({
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
    return {
      _id: channel._id,
      _creationTime: channel._creationTime,
      name: channel.name,
      workspaceId: channel.workspaceId,
      type: channel.type,
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
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.object({ _id: v.id("channels"), name: v.string(), type: channelTypeSchema })),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, type, paginationOpts }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const result = searchText?.trim()
      ? await ctx.db
          .query("channels")
          .withSearchIndex("by_name", (q) => {
            const base = q.search("name", searchText).eq("workspaceId", workspaceId);
            return type !== undefined ? base.eq("type", type) : base;
          })
          .paginate(paginationOpts)
      : type !== undefined
        ? await ctx.db
            .query("channels")
            .withIndex("by_type_workspace", (q) =>
              q.eq("type", type).eq("workspaceId", workspaceId),
            )
            .paginate(paginationOpts)
        : await ctx.db
            .query("channels")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .paginate(paginationOpts);

    return {
      ...result,
      page: result.page.map((c) => ({
        _id: c._id,
        name: c.name,
        type: c.type,
      })),
    };
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
    return {
      _id: channel._id,
      _creationTime: channel._creationTime,
      name: channel.name,
      workspaceId: channel.workspaceId,
      type: channel.type,
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
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

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

    const existing = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();
    if (existing) throw new ConvexError("Already a member of this channel");

    // Dedup: if a pending request already exists, no-op
    const pending = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_user_status", (q) =>
        q.eq("channelId", channelId).eq("userId", userId).eq("status", "pending"),
      )
      .first();
    if (pending) return null;

    await ctx.db.insert("channelJoinRequests", {
      workspaceId: channel.workspaceId,
      channelId,
      userId,
      status: "pending",
    });

    const user = await ctx.db.get(userId);
    const channelAdmins = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_role", (q) =>
        q.eq("channelId", channelId).eq("role", "admin"),
      )
      .collect();

    await notify(ctx, {
      category: "channelJoinRequest",
      userId,
      userName: getUserDisplayName(user),
      recipientIds: channelAdmins.map((a) => a.userId),
      title: `${getUserDisplayName(user)} wants to join #${channel.name}`,
      body: "Open notifications to approve or deny.",
      url: `/workspaces/${channel.workspaceId}`,
    });

    return null;
  },
});

export const getMyPendingRequest = query({
  args: { channelId: v.id("channels") },
  returns: v.union(
    v.object({
      _id: v.id("channelJoinRequests"),
      _creationTime: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;
    const auth = await checkWorkspaceMember(ctx, channel.workspaceId);
    if (!auth) return null;

    const pending = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_user_status", (q) =>
        q.eq("channelId", channelId).eq("userId", auth.userId).eq("status", "pending"),
      )
      .first();
    if (!pending) return null;
    return { _id: pending._id, _creationTime: pending._creationTime };
  },
});

export const listPendingRequestsForAdmin = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("channelJoinRequests"),
      _creationTime: v.number(),
      channelId: v.id("channels"),
      channelName: v.string(),
      workspaceId: v.id("workspaces"),
      workspaceName: v.string(),
      userId: v.id("users"),
      userName: v.string(),
      userEmail: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const auth = await requireUser(ctx);

    const adminMemberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", auth))
      .collect();
    const adminChannelIds = new Set(
      adminMemberships
        .filter((m) => m.role === ChannelRole.ADMIN)
        .map((m) => m.channelId),
    );
    if (adminChannelIds.size === 0) return [];

    // Group admin channels by workspace to query once per workspace
    const workspaceIds = new Set(
      adminMemberships
        .filter((m) => adminChannelIds.has(m.channelId))
        .map((m) => m.workspaceId),
    );

    const requests: Doc<"channelJoinRequests">[] = [];
    for (const workspaceId of workspaceIds) {
      const rows = await ctx.db
        .query("channelJoinRequests")
        .withIndex("by_workspace_status", (q) =>
          q.eq("workspaceId", workspaceId).eq("status", "pending"),
        )
        .collect();
      for (const r of rows) {
        if (adminChannelIds.has(r.channelId)) requests.push(r);
      }
    }

    return Promise.all(
      requests.map(async (r) => {
        const [user, channel, workspace] = await Promise.all([
          ctx.db.get(r.userId),
          ctx.db.get(r.channelId),
          ctx.db.get(r.workspaceId),
        ]);
        return {
          _id: r._id,
          _creationTime: r._creationTime,
          channelId: r.channelId,
          channelName: channel?.name ?? "(deleted channel)",
          workspaceId: r.workspaceId,
          workspaceName: workspace?.name ?? "(deleted workspace)",
          userId: r.userId,
          userName: user ? getUserDisplayName(user) : "(unknown user)",
          userEmail: user?.email,
        };
      }),
    );
  },
});

export const approveJoinRequest = mutation({
  args: { requestId: v.id("channelJoinRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status !== "pending") throw new ConvexError("Request already decided");

    const { userId: adminId } = await requireChannelAccess(ctx, request.channelId, {
      role: ChannelRole.ADMIN,
    });

    const alreadyMember = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", request.channelId).eq("userId", request.userId),
      )
      .first();

    const channel = await ctx.db.get(request.channelId);
    if (!channel) throw new ConvexError("Channel not found");

    if (!alreadyMember) {
      const targetUser = await ctx.db.get(request.userId);
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("channelMembers", {
        userId: request.userId,
        channelId: request.channelId,
        workspaceId: request.workspaceId,
        role: ChannelRole.MEMBER,
        email: targetUser?.email,
        name: targetUser ? getUserDisplayName(targetUser) : undefined,
      });
      await logActivity(ctx, {
        userId: adminId,
        resourceType: "channelMembers",
        resourceId: request.channelId,
        action: "member_added",
        newValue: request.userId,
        resourceName: channel.name,
        scope: request.workspaceId,
      });
    }

    await ctx.db.patch(requestId, {
      status: "approved",
      decidedBy: adminId,
      decidedAt: Date.now(),
    });

    const admin = await ctx.db.get(adminId);
    await notify(ctx, {
      category: "channelJoinDecision",
      userId: adminId,
      userName: getUserDisplayName(admin),
      recipientIds: [request.userId],
      title: `Your request to join #${channel.name} was approved`,
      body: `You can now access the channel.`,
      url: `/workspaces/${request.workspaceId}/channels/${request.channelId}`,
    });

    return null;
  },
});

export const denyJoinRequest = mutation({
  args: { requestId: v.id("channelJoinRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status !== "pending") throw new ConvexError("Request already decided");

    const { userId: adminId } = await requireChannelAccess(ctx, request.channelId, {
      role: ChannelRole.ADMIN,
    });

    const channel = await ctx.db.get(request.channelId);
    if (!channel) throw new ConvexError("Channel not found");

    await ctx.db.patch(requestId, {
      status: "denied",
      decidedBy: adminId,
      decidedAt: Date.now(),
    });

    const admin = await ctx.db.get(adminId);
    await notify(ctx, {
      category: "channelJoinDecision",
      userId: adminId,
      userName: getUserDisplayName(admin),
      recipientIds: [request.userId],
      title: `Your request to join #${channel.name} was declined`,
      body: "Ask the channel admins for more information.",
      url: `/workspaces/${request.workspaceId}`,
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


