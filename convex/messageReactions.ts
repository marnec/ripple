import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const toggle = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    emojiNative: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, emoji, emojiNative }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    // Check if user already reacted with this emoji
    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_emoji_user", (q) =>
        q.eq("messageId", messageId).eq("emoji", emoji).eq("userId", userId)
      )
      .unique();

    if (existing) {
      // Remove reaction
      await ctx.db.delete(existing._id);
    } else {
      // Add reaction
      await ctx.db.insert("messageReactions", {
        messageId,
        userId,
        emoji,
        emojiNative,
      });
    }

    return null;
  },
});

export const listForMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.any(),
  handler: async (ctx, { messageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthenticated");

    // Fetch all reactions for this message
    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();

    // Group by emoji using reduce
    const grouped = reactions.reduce((acc, reaction) => {
      const key = reaction.emoji;
      if (!acc[key]) {
        acc[key] = {
          emoji: reaction.emoji,
          emojiNative: reaction.emojiNative,
          count: 0,
          userIds: [],
        };
      }
      acc[key].count++;
      acc[key].userIds.push(reaction.userId);
      return acc;
    }, {} as Record<string, { emoji: string; emojiNative: string; count: number; userIds: string[] }>);

    // Convert to array and add currentUserReacted flag
    return Object.values(grouped).map((group) => ({
      ...group,
      currentUserReacted: group.userIds.includes(userId),
    }));
  },
});
