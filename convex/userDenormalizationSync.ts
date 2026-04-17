/**
 * Syncs denormalized user fields (`name`, `email`) stored on `channelMembers`
 * rows to match the authoritative values on the user's row.
 *
 * Scheduled from the `users` trigger in dbTriggers.ts whenever a user's name
 * or email changes (rare — happens on SSO refresh). Runs as an internal
 * mutation so it's transactional and cheap; wrapped in the scheduler so the
 * originating user mutation returns quickly and any failure here can be
 * retried independently.
 *
 * If the user has thousands of channelMember rows, the single mutation could
 * approach Convex's per-mutation write limit. Add pagination here if that
 * becomes a problem (rare — typical users are in tens of channels).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getUserDisplayName } from "@shared/displayName";

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

    for (const m of memberships) {
      const updates: { name?: string; email?: string } = {};
      if (m.name !== name) updates.name = name;
      if (m.email !== email) updates.email = email;
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(m._id, updates);
      }
    }

    return null;
  },
});
