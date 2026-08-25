import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { checkChannelAccess, requireChannelAccess } from "./authHelpers";

/**
 * A reaction is message data, so it inherits the message's channel rule.
 * These three functions previously gated on `requireUser` alone and never
 * loaded the `messages` row: the read side leaked the reacting userIds on any
 * private message, and the write side let an outsider inject a reaction that
 * renders for real channel members.
 */
export const toggle = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    emojiNative: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, emoji, emojiNative }) => {
    const message = await ctx.db.get(messageId);
    if (!message) throw new ConvexError("Message not found");
    const { userId } = await requireChannelAccess(ctx, message.channelId);

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

export const reactionGroupValidator = v.object({
  emoji: v.string(),
  emojiNative: v.string(),
  count: v.number(),
  userIds: v.array(v.string()),
  currentUserReacted: v.boolean(),
});

/**
 * Group raw reactions by emoji for a single message.
 *
 * Callers pass rows straight off the `by_message` index, which scans in
 * `_creationTime` order — so the insertion order of `grouped` is
 * first-reaction-first, and `Object.values` preserves it. That is what keeps
 * the chips from reordering under a reader as counts change; there is no
 * separate sort key to store.
 */
export function groupReactions(
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

/**
 * Reactions for a page of messages are NOT fetched here — they ride on the
 * message itself, out of `enrichMessages` in `messages.ts`, alongside the five
 * other per-message relations (replyTo and the four mention kinds).
 *
 * The batch query this replaced took `messageIds` derived from the result of
 * `messages.list`. That made its args change every time a message arrived, so
 * Convex tore down the subscription and re-issued it, and the client held
 * `undefined` for a round trip — every reaction chip in the channel unmounted
 * and remounted on every send. Args that derive from another query's results
 * cannot be made stable; the fix is to not have the second query.
 */
export const listForMessage = query({
  args: { messageId: v.id("messages") },
  returns: v.array(reactionGroupValidator),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return [];
    const access = await checkChannelAccess(ctx, message.channelId);
    if (!access) return [];

    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();

    return groupReactions(reactions, access.userId);
  },
});
