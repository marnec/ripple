import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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
    const results: Record<string, { emoji: string; emojiNative: string; count: number; userIds: string[]; currentUserReacted: boolean }[]> = {};

    // Resolve each message's channel first, then check each DISTINCT channel
    // once — a batch normally spans a single channel, so this is one access
    // check regardless of page size. Messages in an unreachable channel are
    // dropped rather than throwing, so one stale id cannot blank the page.
    const messages = await Promise.all(messageIds.map((id) => ctx.db.get(id)));
    const channelIds = [
      ...new Set(messages.filter((m) => m !== null).map((m) => m.channelId)),
    ];
    const accessByChannel = new Map<Id<"channels">, boolean>();
    let userId: Id<"users"> | null = null;
    for (const channelId of channelIds) {
      const access = await checkChannelAccess(ctx, channelId);
      accessByChannel.set(channelId, access !== null);
      if (access) userId = access.userId;
    }
    if (!userId) return results;

    const currentUserId = userId;
    await Promise.all(
      messages.map(async (message) => {
        if (!message || !accessByChannel.get(message.channelId)) return;
        const reactions = await ctx.db
          .query("messageReactions")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        const grouped = groupReactions(reactions, currentUserId);
        if (grouped.length > 0) {
          results[message._id] = grouped;
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
