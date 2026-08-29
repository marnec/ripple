import { ConvexError, v } from "convex/values";
import { mutation } from "./functions";
import { requireChannelAccess } from "./authHelpers";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
    // The channel rule, not the workspace rule. A public channel admits every
    // workspace member, so dismissing one is unchanged; a DM is now dismissable
    // only by a participant, where before any workspace member could write a
    // `userChannelState` row for a conversation they cannot read.
    //
    // Access before shape, and deliberately so: the shape throw describes the
    // channel, so running it first made this mutation an oracle for any id an
    // authenticated caller cared to try. A non-member of a private channel now
    // gets "Not a member of this channel" instead, and everyone the message
    // below was written for — people who can actually see the channel — still
    // reads it. Do not reorder these.
    const { userId, channel } = await requireChannelAccess(ctx, channelId);

    if (isPrivateChannel(channel)) {
      throw new ConvexError("Private channels cannot be dismissed; leave the channel instead");
    }

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
 * Undo one user's dismissal, if there is one. Idempotent — a no-op when there
 * is no state row or the conversation was never dismissed.
 *
 * Shared with `channels.createDm`, because deliberately opening a conversation
 * is as clear a statement of intent as picking "Reopen conversation" from a
 * menu: without this, a member who dismissed a DM and then started it again
 * from the sidebar's "+" would land in a conversation their sidebar says they
 * do not have.
 *
 * Uses `replace` because Convex `patch` cannot remove an optional field — so
 * every column `userChannelState` gains has to be listed here, or this quietly
 * deletes it.
 */
export async function clearDismissal(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
): Promise<void> {
  const existing = await ctx.db
    .query("userChannelState")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  if (!existing || existing.hiddenAt === undefined) return;

  await ctx.db.replace(existing._id, {
    userId: existing.userId,
    channelId: existing.channelId,
    workspaceId: existing.workspaceId,
    lastReadAt: existing.lastReadAt,
    // hiddenAt omitted — cleared
  });
}

/** Clear `hiddenAt` so the conversation returns to the caller's sidebar. */
export const restoreChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    // Same rule as `dismissChannel` — restoring a conversation is reaching
    // into the same per-user row, and needs the same access to it.
    const { userId } = await requireChannelAccess(ctx, channelId);
    await clearDismissal(ctx, channelId, userId);
    return null;
  },
});
