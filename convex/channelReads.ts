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

export const getUnreadCount = query({
  args: { channelId: v.id("channels") },
  returns: v.number(),
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("channelMembers")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .first();

    // No membership or no lastReadAt → treat as all read (0 unread)
    if (!membership?.lastReadAt) return 0;

    const lastReadAt = membership.lastReadAt;

    // Count undeleted messages after lastReadAt
    const messages = await ctx.db
      .query("messages")
      .withIndex("undeleted_by_channel", (q) =>
        q.eq("channelId", channelId).eq("deleted", false)
      )
      .collect();

    const unreadCount = messages.filter((m) => m._creationTime > lastReadAt).length;

    return Math.min(unreadCount, 99);
  },
});
