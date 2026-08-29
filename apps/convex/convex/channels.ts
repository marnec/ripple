import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "./_generated/server";
import { mutation } from "./functions";
import { ChannelKind, ChannelRole, ChannelVisibility } from "@ripple/shared/enums";
import { logActivity } from "./auditLog";
import { getUserDisplayName } from "@ripple/shared/displayName";
import { WORKSPACE_CHANNEL_LIMIT } from "@ripple/shared/constants";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { channelLabel } from "./lib/dmLabel";
import schema from "./schema";
import { internal } from "./_generated/api";
import { cascadeDelete } from "./cascadeDelete";
import { requireWorkspaceMember, checkWorkspaceMember, requireChannelAccess, requireUser } from "./authHelpers";
import { clearDismissal } from "./channelDismissal";
import { notify } from "./utils/notify";
import { channelKindSchema, channelVisibilitySchema } from "./schema";
import type { Doc } from "./_generated/dataModel";

import { isDirectMessage, isPublicChannel, isPrivateChannel } from "@ripple/shared/channel";
export const create = mutation({
  args: {
    name: v.string(),
    workspaceId: v.id("workspaces"),
    // A visibility, not a kind. This mutation cannot build a direct message:
    // it inserts a single `channelMembers` row for the creator, where a DM
    // needs exactly two, and `dmLabelForViewer` derives a DM's label from that
    // roster — so a one-participant DM could never name itself, and
    // `createDm`'s dedup would never match it. `createDm` is the only way a
    // direct message comes into being, and the type system now says so.
    visibility: channelVisibilitySchema,
  },
  returns: v.id("channels"),
  handler: async (ctx, { name, visibility, workspaceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Per-workspace channel cap. Counts channels only — see
    // WORKSPACE_CHANNEL_LIMIT for why DMs are excluded. `createDm` is not
    // gated at all for the same reason.
    //
    // One bounded range on `by_kind_workspace`, where this used to need two
    // added together: "every channel, whichever visibility" is expressible as
    // an index range now that kind is its own column. Not the
    // `channelsByWorkspace` aggregate, which is namespaced by workspace alone
    // and so counts DMs too.
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_kind_workspace", (q) =>
        q.eq("kind", ChannelKind.CHANNEL).eq("workspaceId", workspaceId),
      )
      .take(WORKSPACE_CHANNEL_LIMIT);
    if (channels.length >= WORKSPACE_CHANNEL_LIMIT) {
      throw new ConvexError(
        `This workspace has reached its limit of ${WORKSPACE_CHANNEL_LIMIT} channels. Delete a channel to create a new one.`,
      );
    }

    const channelId = await ctx.db.insert("channels", {
      name,
      workspaceId,
      kind: ChannelKind.CHANNEL,
      visibility,
    });

    // A private channel needs its creator on the roster; a public one has no
    // roster to be on.
    if (visibility === ChannelVisibility.PRIVATE) {
      const creator = await ctx.db.get(userId);
      await ctx.db.insert("channelMembers", {
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

// Channels that can host a calendar event's meeting room — i.e. open + closed,
// excluding DMs. The calendar "Hosted in" picker uses this. DMs are excluded
// because a DM has no agenda of its own and reusing its persistent room would
// surface the meeting to whichever two members the DM happens to belong to.
// One indexed range on `by_kind_workspace`, so we never call .filter() and
// never read DM rows.
export const listHostable = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({
    _id: v.id("channels"),
    _creationTime: v.number(),
    name: v.string(),
    workspaceId: v.id("workspaces"),
    kind: channelKindSchema,
    visibility: channelVisibilitySchema,
  })),
  handler: async (ctx, { workspaceId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    const hostable = await ctx.db
      .query("channels")
      .withIndex("by_kind_workspace", (q) =>
        q.eq("kind", ChannelKind.CHANNEL).eq("workspaceId", workspaceId),
      )
      .collect();

    return hostable.map((c) => ({
      _id: c._id,
      _creationTime: c._creationTime,
      name: c.name,
      workspaceId: c.workspaceId,
      kind: c.kind,
      visibility: c.visibility,
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
      kind: channelKindSchema,
      visibility: channelVisibilitySchema,
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
      // A DM stores no label, so derive it here rather than at each caller:
      // the chat header, the call share sheet and the recent-items list all
      // read this query's `name`, and none of them should have to know that a
      // DM is different. Viewer-relative, because a conversation is labelled
      // with the other person.
      //
      // This does not reopen the discovery hole that removing DMs from search
      // closed: reaching this query means already holding the channel id, and
      // `getAccessInfo` deliberately discloses a DM's participants to exactly
      // that caller so the "you are not in this conversation" gate can name
      // them. What a DM is not is *findable* without the id.
      name: await channelLabel(ctx, channel, auth.userId),
      workspaceId: channel.workspaceId,
      kind: channel.kind,
      visibility: channel.visibility,
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
    if (channelDoc && isDirectMessage(channelDoc)) {
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
      await ctx.db.patch(id, updates);
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
    // A visibility, or nothing for "all" — this one stays optional, unlike the
    // column: absence here means "do not filter", not "unknown". A direct
    // message is not a browsable resource (its name is its roster) and is
    // excluded by `kind`, not by there being no value to name it with.
    visibility: v.optional(channelVisibilitySchema),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("channels"),
        name: v.string(),
        kind: channelKindSchema,
        visibility: channelVisibilitySchema,
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, searchText, visibility, paginationOpts }) => {
    await requireWorkspaceMember(ctx, workspaceId);

    const result = searchText?.trim()
      ? // Direct messages are excluded by an equality filter on `kind`, not by
        // discarding them afterwards. While the two axes shared a column this
        // was impossible — a search index's filterFields do whole-value
        // equality, so "any type except dm" had nowhere to live — and the
        // post-filter it forced could hand back a short page.
        await ctx.db
          .query("channels")
          .withSearchIndex("by_name", (q) => {
            const base = q
              .search("name", searchText)
              .eq("workspaceId", workspaceId)
              .eq("kind", ChannelKind.CHANNEL);
            return visibility !== undefined ? base.eq("visibility", visibility) : base;
          })
          .paginate(paginationOpts)
      : visibility !== undefined
        ? await ctx.db
            .query("channels")
            .withIndex("by_kind_visibility_workspace", (q) =>
              q
                .eq("kind", ChannelKind.CHANNEL)
                .eq("visibility", visibility)
                .eq("workspaceId", workspaceId),
            )
            .paginate(paginationOpts)
        : // "All" is one range now: every channel in the workspace, whichever
          // visibility, never a DM. This used to be a merge of two index
          // ranges interleaved by `_creationTime`, because "not a DM" was not
          // an expressible range. `by_kind_workspace` is ordered by
          // `_creationTime` already, so the page order is unchanged.
          await ctx.db
            .query("channels")
            .withIndex("by_kind_workspace", (q) =>
              q.eq("kind", ChannelKind.CHANNEL).eq("workspaceId", workspaceId),
            )
            .paginate(paginationOpts);

    return {
      ...result,
      page: result.page.map((c) => ({
        _id: c._id,
        name: c.name,
        kind: c.kind,
        visibility: c.visibility,
      })),
    };
  },
});

// `getInternal` used to sit here: an action-facing projection of a channel row
// with no caller anywhere in the monorepo. It shared `get`'s return validator
// while returning the *stored* name, so a direct message came back labelled
// with the empty string — one of the two sites that had forgotten the label
// derivation, and the reason two functions with one validator disagreed about
// what `name` meant.

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
      if (!channel || !isDirectMessage(channel)) continue;

      const allMembers = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", cm.channelId))
        .collect();

      for (const m of allMembers) {
        if (m.userId === userId) continue;
        if (m.userId === otherUserId) {
          // Asking for this conversation is asking for it back. Only the
          // caller's dismissal is cleared — the other participant did not ask
          // for anything, and dismissal is per-user.
          await clearDismissal(ctx, cm.channelId, userId);
          return cm.channelId;
        }
        if (otherEmail && m.email === otherEmail) {
          // Reinstate: point the stale membership at the current userId
          await ctx.db.patch(m._id, { userId: otherUserId });
          await clearDismissal(ctx, cm.channelId, userId);
          return cm.channelId;
        }
      }
    }

    // No existing DM — create one with NO stored label. A DM's label is
    // derived from its participants at read time (`lib/dmLabel.ts`).
    //
    // It used to be materialized here as a sorted `<A> × <B>` snapshot, which
    // then went stale on any rename — so a fan-out job patched every affected
    // DM whenever a display name changed. That job existed to feed
    // `channels.searchIndex("by_name")`, since a search index can only index a
    // stored field. A DM is no longer workspace-wide discoverable, so there is
    // no index to feed and nothing to keep fresh.
    //
    // `callerName` / `otherName` are still computed below, for the activity
    // log: an audit entry is a point-in-time record and *should* say the name
    // as of the event, which is the opposite of a cache.
    const callerName = callerUser ? getUserDisplayName(callerUser) : "Unknown";
    const otherName = otherUser ? getUserDisplayName(otherUser) : "Unknown";
    const [first, second] = [callerName, otherName].sort();
    const dmName = `${first} × ${second}`;

    const channelId = await ctx.db.insert("channels", {
      name: "",
      workspaceId,
      kind: ChannelKind.DM,
      // A derived constant, not a setting: a direct message has no visibility.
      // It exists so the column can be required and so indexes leading with it
      // need not sort around an absent value.
      visibility: ChannelVisibility.PRIVATE,
    });

    await ctx.db.insert("channelMembers", {
      channelId,
      userId,
      role: ChannelRole.MEMBER,
      workspaceId,
      email: callerUser?.email,
      name: callerName,
    });

    await ctx.db.insert("channelMembers", {
      channelId,
      userId: otherUserId,
      role: ChannelRole.MEMBER,
      workspaceId,
      email: otherEmail,
      name: otherName,
    });

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: channelId,
      action: "dm_created", newValue: otherName,
      resourceName: dmName, scope: workspaceId,
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
      // The rendered label, not the roster. Handing back raw participants left
      // the gate to join them itself, and it did — with " and " instead of
      // " × ", unsorted, so the two people in a conversation read different
      // orderings of themselves, and with no overflow or empty case.
      label: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    const auth = await checkWorkspaceMember(ctx, channel.workspaceId);
    if (!auth) return null;

    // Open channels: everyone is a member
    if (isPublicChannel(channel)) return { isMember: true as const };

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
    if (isDirectMessage(channel)) {
      // The viewer is by definition not a participant here, so there is nobody
      // for the label to be relative to — the full form names both people.
      // This also drops an unbounded `.collect()` on the roster: `channelLabel`
      // takes a bounded read and reports overflow rather than assuming two.
      return {
        isMember: false as const,
        type: "dm" as const,
        label: await channelLabel(ctx, channel),
      };
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

    // Membership before shape. The two throws below describe the channel, so
    // running them first let any authenticated caller — including someone with
    // no membership of the owning workspace at all — probe ids and learn which
    // of the three shapes each one is. The channel rule cannot be used here:
    // the whole point of a join request is that the caller is not a member.
    const { userId } = await requireWorkspaceMember(ctx, channel.workspaceId);

    if (isPublicChannel(channel)) throw new ConvexError("Channel is open — just join");
    if (isDirectMessage(channel)) throw new ConvexError("Cannot request to join a DM");

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

    await logActivity(ctx, {
      userId, resourceType: "channels", resourceId: channelId,
      action: "join_requested", resourceName: channel.name,
      scope: channel.workspaceId,
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
      await ctx.db.insert("channelMembers", {
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

    await logActivity(ctx, {
      userId: adminId, resourceType: "channels", resourceId: channel._id,
      action: "join_denied", resourceName: channel.name,
      scope: request.workspaceId,
    });

    return null;
  },
});

// `findDm` was removed: no callers anywhere in the monorepo. The DM the UI
// actually opens is resolved inside `createDm`, which does the same
// userId-then-denormalized-email dedup scan and creates the channel when there
// is none — this query was a second, unexercised copy of that scan (one
// `ctx.db.get` per membership row plus a full member list per DM) sitting on
// the public API.

