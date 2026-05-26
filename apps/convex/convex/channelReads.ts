import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getWorkspaceMembership, requireUser } from "./authHelpers";

export const markRead = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const userId = await requireUser(ctx);

    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    // Access model mirrors `requireChannelAccess`:
    //   - open channels: any workspace member (no channelMembers row exists)
    //   - closed / dm channels: must have a channelMembers row
    // Without the open-channel branch, markRead silently no-ops for open
    // channels, so they never get a `lastReadAt` and can never show an
    // unread badge — which is exactly the bug we're fixing.
    const workspaceMembership = await getWorkspaceMembership(
      ctx,
      channel.workspaceId,
      userId,
    );
    if (!workspaceMembership) return null;

    if (channel.type !== "open") {
      const channelMembership = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
        .first();
      if (!channelMembership) return null;
    }

    const existing = await ctx.db
      .query("userChannelState")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { lastReadAt: Date.now() });
    } else {
      await ctx.db.insert("userChannelState", {
        userId,
        channelId,
        workspaceId: channel.workspaceId,
        lastReadAt: Date.now(),
      });
    }

    return null;
  },
});


// We intentionally surface only a boolean "something new" signal per channel —
// no numeric unread count. This is a product decision (see README): exact
// per-channel counts are noise under our "only essential information" UX
// principle, and computing them costs either a per-message scan or a
// maintained aggregate (extra writes + per-channel root contention on our
// highest-write-rate table). A boolean needs neither: `.first()` on the
// `undeleted_by_channel` index is a single indexed read that stops at the
// first message after the baseline, and stays correct under soft-deletes
// (it reads live rows, so a deleted message never lingers as "unread").
export const getUnreadStatus = query({
  args: { channelIds: v.array(v.id("channels")) },
  returns: v.array(
    v.object({ channelId: v.id("channels"), hasUnread: v.boolean() }),
  ),
  handler: async (ctx, { channelIds }) => {
    if (channelIds.length > 50) throw new Error("Too many channels");

    const userId = await requireUser(ctx);

    // All channels in a sidebar batch share a workspace, so resolve the
    // workspace-join time once per workspace rather than per channel.
    const wsJoinCache = new Map<Id<"workspaces">, number | null>();
    const workspaceJoinTime = async (workspaceId: Id<"workspaces">) => {
      const cached = wsJoinCache.get(workspaceId);
      if (cached !== undefined) return cached;
      const wm = await getWorkspaceMembership(ctx, workspaceId, userId);
      const t = wm?._creationTime ?? null;
      wsJoinCache.set(workspaceId, t);
      return t;
    };

    return Promise.all(
      channelIds.map(async (channelId) => {
        const state = await ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId),
          )
          .unique();

        // Baseline = when the user last read the channel. If they've never
        // opened it, fall back to a sensible "joined" point so the channel
        // still badges for messages that arrived after they gained access:
        //   - open channels:    when they joined the workspace
        //   - closed/dm:        when they joined the channel
        // The fallback reads only run on the cold (never-visited) path;
        // visited channels stay at one state read + one message read.
        let baseline = state?.lastReadAt;
        if (baseline == null) {
          const channel = await ctx.db.get(channelId);
          if (!channel) return { channelId, hasUnread: false };

          if (channel.type === "open") {
            const wsJoin = await workspaceJoinTime(channel.workspaceId);
            if (wsJoin == null) return { channelId, hasUnread: false };
            baseline = wsJoin;
          } else {
            const membership = await ctx.db
              .query("channelMembers")
              .withIndex("by_channel_user", (q) =>
                q.eq("channelId", channelId).eq("userId", userId),
              )
              .first();
            if (!membership) return { channelId, hasUnread: false };
            baseline = membership._creationTime;
          }
        }

        const next = await ctx.db
          .query("messages")
          .withIndex("undeleted_by_channel", (q) =>
            q
              .eq("channelId", channelId)
              .eq("deleted", false)
              .gt("_creationTime", baseline),
          )
          .first();

        return { channelId, hasUnread: next !== null };
      }),
    );
  },
});
