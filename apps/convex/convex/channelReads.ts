import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./authHelpers";

export const markRead = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const userId = await requireUser(ctx);

    // Resolve workspaceId from the channel — needed for the by_workspace_user
    // index on userChannelState so sidebar queries can fetch all of a user's
    // per-channel state in one shot.
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;

    // Only track unreads for channels the user is actually a member of.
    // Public channels without an explicit membership row are a no-op.
    const membership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .first();
    if (!membership) return null;

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


export const getUnreadCounts = query({
  args: { channelIds: v.array(v.id("channels")) },
  returns: v.array(
    v.object({ channelId: v.id("channels"), count: v.number() }),
  ),
  handler: async (ctx, { channelIds }) => {
    if (channelIds.length > 50) throw new Error("Too many channels");

    const userId = await requireUser(ctx);

    return Promise.all(
      channelIds.map(async (channelId) => {
        const state = await ctx.db
          .query("userChannelState")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId),
          )
          .unique();

        if (!state?.lastReadAt) return { channelId, count: 0 };

        const lastReadAt = state.lastReadAt;
        const unreadMessages = await ctx.db
          .query("messages")
          .withIndex("undeleted_by_channel", (q) =>
            q
              .eq("channelId", channelId)
              .eq("deleted", false)
              .gt("_creationTime", lastReadAt),
          )
          .take(100);

        return { channelId, count: Math.min(unreadMessages.length, 99) };
      }),
    );
  },
});
