import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { checkChannelAccess, checkChannelAccessBatch, requireUser } from "./authHelpers";

import { isPublicChannel } from "@ripple/shared/channel";
export const markRead = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    // Authentication is not authorization. An unauthenticated caller is a
    // client bug and hears about it; an authenticated caller without access
    // degrades to a no-op, which is what the soft check below is for.
    await requireUser(ctx);

    // The channel rule, soft: an open channel admits any workspace member, a
    // closed or dm channel needs a `channelMembers` row. The open branch is
    // load-bearing — without it markRead silently no-ops on open channels, so
    // they never get a `lastReadAt` and can never badge.
    const access = await checkChannelAccess(ctx, channelId);
    if (!access) return null;
    const { userId, channel } = access;

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

    // Authentication is not authorization — see `markRead`.
    await requireUser(ctx);

    // The channel rule for every id, not only for the ones with no state row.
    // A surviving `userChannelState` row is not proof of access: nothing
    // deletes those rows when a workspace membership goes, so trusting one as
    // a shortcut left a removed member with a live unread signal on a
    // workspace they had been ejected from. The batch form resolves workspace
    // membership once, which is what the per-channel loop here used to do by
    // hand — and why the rule had drifted into the baseline branch.
    const access = await checkChannelAccessBatch(ctx, channelIds);

    return Promise.all(
      channelIds.map(async (channelId) => {
        const entry = access.get(channelId);
        if (!entry) return { channelId, hasUnread: false };

        const { userId, channel, workspaceMembership, channelMembership } = entry;

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
        // Both are already read by the access check, so the cold path costs
        // nothing extra.
        const joinedAt =
          isPublicChannel(channel) || channelMembership === null
            ? workspaceMembership._creationTime
            : channelMembership._creationTime;
        const baseline = state?.lastReadAt ?? joinedAt;

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
