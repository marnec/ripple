import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireWorkspaceMember } from "./authHelpers";

/**
 * Hide a channel from the calling user's sidebar.
 *
 * Semantics by channel type:
 *   - "open": stays hidden until `unhideChannel` is called. The sidebar query
 *     treats any `hiddenAt` value as "hidden."
 *   - "dm":   stays hidden until a message arrives newer than `hiddenAt`. The
 *     sidebar query derives this without an extra write, so the auto-unhide
 *     is free.
 *   - "closed": rejected — closed channels are left (`removeFromChannel`), not
 *     hidden.
 *
 * Lives on `userChannelState` (not `channelMembers`) so the write only
 * invalidates the calling user's subscriptions — never fans out to other
 * channel members.
 */
export const hideChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (channel.type === "closed") {
      throw new ConvexError("Closed channels cannot be hidden; leave the channel instead");
    }

    const { userId } = await requireWorkspaceMember(ctx, channel.workspaceId);

    const existing = await ctx.db
      .query("userChannelState")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { hiddenAt: now });
    } else {
      await ctx.db.insert("userChannelState", {
        userId,
        channelId,
        workspaceId: channel.workspaceId,
        hiddenAt: now,
      });
    }
    return null;
  },
});

/**
 * Clear `hiddenAt` so the channel shows up in the sidebar again. Idempotent
 * — no-op if there's no state row or it's already unhidden.
 *
 * Uses `replace` because Convex `patch` cannot remove an optional field.
 */
export const unhideChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");

    const { userId } = await requireWorkspaceMember(ctx, channel.workspaceId);

    const existing = await ctx.db
      .query("userChannelState")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (!existing || existing.hiddenAt === undefined) return null;

    await ctx.db.replace(existing._id, {
      userId: existing.userId,
      channelId: existing.channelId,
      workspaceId: existing.workspaceId,
      lastReadAt: existing.lastReadAt,
      // hiddenAt omitted — cleared
    });
    return null;
  },
});
