import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./authHelpers";

export const toggle = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    emojiNative: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, emoji, emojiNative }) => {
    const userId = await requireUser(ctx);

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

const reactionGroupValidator = v.object({
  emoji: v.string(),
  emojiNative: v.string(),
  count: v.number(),
  userIds: v.array(v.string()),
  currentUserReacted: v.boolean(),
});

/** Group raw reactions by emoji for a single message. */
function groupReactions(
  reactions: { emoji: string; emojiNative: string; userId: string }[],
  currentUserId: string,
) {
  const grouped: Record<string, { emoji: string; emojiNative: string; count: number; userIds: string[] }> = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = { emoji: r.emoji, emojiNative: r.emojiNative, count: 0, userIds: [] };
    }
    grouped[r.emoji].count++;
    grouped[r.emoji].userIds.push(r.userId);
  }
  return Object.values(grouped).map((g) => ({
    ...g,
    currentUserReacted: g.userIds.includes(currentUserId),
  }));
}

/** Batch-fetch reactions for multiple messages in a single query. */
export const listForMessages = query({
  args: { messageIds: v.array(v.id("messages")) },
  returns: v.record(v.string(), v.array(reactionGroupValidator)),
  handler: async (ctx, { messageIds }) => {
    const userId = await requireUser(ctx);

    const results: Record<string, { emoji: string; emojiNative: string; count: number; userIds: string[]; currentUserReacted: boolean }[]> = {};

    await Promise.all(
      messageIds.map(async (messageId) => {
        const reactions = await ctx.db
          .query("messageReactions")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .collect();
        const grouped = groupReactions(reactions, userId);
        if (grouped.length > 0) {
          results[messageId] = grouped;
        }
      }),
    );

    return results;
  },
});

export const listForMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.array(reactionGroupValidator),
  handler: async (ctx, { messageId }) => {
    const userId = await requireUser(ctx);

    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();

    return groupReactions(reactions, userId);
  },
});
