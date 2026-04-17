/**
 * Syncs denormalized user fields (`name`, `email`) stored on `channelMembers`
 * rows — and DM channel names derived from those fields — to match the
 * authoritative values on the user's row.
 *
 * Scheduled from the `users` trigger in dbTriggers.ts whenever a user's name
 * or email changes (rare — happens on SSO refresh). Runs as an internal
 * mutation so it's transactional and cheap; wrapped in the scheduler so the
 * originating user mutation returns quickly and any failure here can be
 * retried independently.
 *
 * Three things happen here:
 *   1. Patch each of the user's channelMembers rows to hold their fresh
 *      name/email (denormalized for N+1 avoidance).
 *   2. For every DM the user is in, recompute the channel name in the
 *      `<A> × <B>` format (sorted) and patch the channel row. The channels
 *      trigger propagates the new channel name to the node in the `nodes`
 *      table automatically.
 *
 * If the user has thousands of channelMember rows, the single mutation could
 * approach Convex's per-mutation write limit. Add pagination here if that
 * becomes a problem (rare — typical users are in tens of channels).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getUserDisplayName } from "@shared/displayName";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "./dbTriggers";

export const syncToChannelMembers = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const name = getUserDisplayName(user);
    const email = user.email;

    const memberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // 1. Refresh denormalized name/email on this user's channelMember rows
    for (const m of memberships) {
      const updates: { name?: string; email?: string } = {};
      if (m.name !== name) updates.name = name;
      if (m.email !== email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(m._id, updates);
      }
    }

    // 2. Recompute DM channel names. The channels trigger will sync the new
    //    channel name to the node in the `nodes` table, so we use
    //    writerWithTriggers for the channel patch.
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    for (const m of memberships) {
      const channel = await ctx.db.get(m.channelId);
      if (channel?.type !== "dm") continue;

      const dmMembers = await ctx.db
        .query("channelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", m.channelId))
        .collect();

      // Gather both participants' fresh names. For the user being synced we
      // already have it; for the other we look up the users table directly to
      // avoid relying on possibly-stale denormalized data on the other row.
      const names: string[] = [];
      for (const dm of dmMembers) {
        if (dm.userId === userId) {
          names.push(name);
        } else {
          const otherUser = await ctx.db.get(dm.userId);
          names.push(otherUser ? getUserDisplayName(otherUser) : "Unknown");
        }
      }
      names.sort();
      const newDmName = names.length === 2 ? `${names[0]} × ${names[1]}` : names.join(" × ");

      if (channel.name !== newDmName) {
        await db.patch(m.channelId, { name: newDmName });
      }
    }

    return null;
  },
});
