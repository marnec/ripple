import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const markRead = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .first();

    if (membership) {
      await ctx.db.patch(membership._id, { lastReadAt: Date.now() });
    }
    // For public channels where user has no membership row, this is a no-op.
    // Unread tracking only applies to channels the user is a member of.

    return null;
  },
});


export const getUnreadCounts = query({
  args: { channelIds: v.array(v.id("channels")) },
  returns: v.array(
    v.object({ channelId: v.id("channels"), count: v.number() }),
  ),
  handler: async (ctx, { channelIds }) => {
    if (channelIds.length > 50) throw new ConvexError("Too many channels");

    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    return Promise.all(
      channelIds.map(async (channelId) => {
        const membership = await ctx.db
          .query("channelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId),
          )
          .first();

        if (!membership?.lastReadAt) return { channelId, count: 0 };

        const lastReadAt = membership.lastReadAt;
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
