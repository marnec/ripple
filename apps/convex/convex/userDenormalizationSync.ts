/**
 * Recomputes DM channel names after a user's display name changes.
 *
 * Scheduled from the `users` trigger in dbTriggers.ts. This is the *deferred*
 * half of the user-denormalization story; the other half — refreshing
 * `name`/`email` on the user's `channelMembers` rows — now runs inline in that
 * trigger, because `channelMembers.email` is the DM-dedup key and must not be
 * able to drift. See the comment there.
 *
 * This half stays deferred on purpose. It reads every member of every DM the
 * user belongs to and patches `channels.name`, which cascades through the
 * channels trigger into the `nodes` table — the expensive, fan-out-heavy side.
 * And it tolerates delay in a way the key does not: a DM label that is briefly
 * stale is cosmetic, and `workspaceSidebarData` resolves an unnamed DM from
 * the participants anyway.
 *
 * `channels.name` for a DM is itself a correctly-denormalized derived value:
 * it backs `channels.searchIndex("by_name")`, and a search index cannot index
 * a computed value.
 *
 * If the user has thousands of DMs the single mutation could approach Convex's
 * per-mutation write limit. Add pagination here if that becomes a problem
 * (rare — a user's DM count is bounded by their workspaces' member counts).
 */
import { v } from "convex/values";
import { internalMutation } from "./functions";
import { getUserDisplayName } from "@ripple/shared/displayName";

export const syncDmChannelNames = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;

    const name = getUserDisplayName(user);

    const memberships = await ctx.db
      .query("channelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Recompute DM channel names. The channels trigger syncs the new channel
    // name onto the row in the `nodes` table.
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
        await ctx.db.patch(m.channelId, { name: newDmName });
      }
    }

    return null;
  },
});
