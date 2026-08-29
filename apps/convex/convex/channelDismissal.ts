import { ConvexError, v } from "convex/values";
import { mutation } from "./functions";
import { requireWorkspaceMember } from "./authHelpers";

import { isPrivateChannel } from "@ripple/shared/channel";
/**
 * **Dismissal**: one user drops a conversation out of their own sidebar.
 *
 * Not **visibility**, which is a property of a channel and identical for
 * everyone who can see it. This is per-user view state, and it used to occupy
 * that word — see `CONTEXT.md`.
 *
 * Semantics, by what the conversation is:
 *   - a **public channel**: stays dismissed until `restoreChannel` is called.
 *     The sidebar query treats any `hiddenAt` value as dismissed. This is the
 *     only way to decline one, since you are not a member and so have nothing
 *     to leave.
 *   - a **direct message**: stays dismissed until a message arrives newer than
 *     `hiddenAt`. The sidebar query derives that without an extra write, so the
 *     auto-restore is free. It is also the whole lifecycle of a DM, which can
 *     be neither deleted nor left.
 *   - a **private channel**: rejected — those are left
 *     (`removeFromChannel`), not dismissed.
 *
 * The stored column is still `hiddenAt`. Renaming it is a second migration on a
 * second table, and it appears in no user-facing string.
 *
 * Lives on `userChannelState` (not `channelMembers`) so the write only
 * invalidates the calling user's subscriptions — never fans out to other
 * channel members.
 */
export const dismissChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (isPrivateChannel(channel)) {
      throw new ConvexError("Private channels cannot be dismissed; leave the channel instead");
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
 * Clear `hiddenAt` so the conversation returns to the sidebar. Idempotent — a
 * no-op if there is no state row, or it was never dismissed.
 *
 * Uses `replace` because Convex `patch` cannot remove an optional field.
 */
export const restoreChannel = mutation({
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
