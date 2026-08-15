import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { requireChannelAccess, checkChannelAccess } from "./authHelpers";

const preferencesValidator = v.object({
  _id: v.id("channelNotificationPreferences"),
  _creationTime: v.number(),
  userId: v.id("users"),
  channelId: v.id("channels"),
  chatMention: v.boolean(),
  chatChannelMessage: v.boolean(),
});

/**
 * A row in this table is not a private setting — it is a standing grant. Saving
 * `chatChannelMessage: true` materializes a `notificationSubscriptions` row that
 * the broadcast path in `notificationDelivery.getSubscribedUserIds` reads
 * blind, so from then on every message posted in the channel pushes its sender
 * and its plaintext opening lines to that user. That makes these two functions
 * a read path on channel content, and they take the **channel** rule
 * accordingly — the workspace rule they used to apply let any colleague
 * subscribe themselves to a closed channel or someone else's DM.
 *
 * `messages.send` already narrows its *mention* recipients with
 * `filterChannelRecipients`; the broadcast recipients are narrowed here and at
 * the sink (`onChannelPreferencesChange`), because by delivery time the
 * subscription row is all that is left.
 */
export const get = query({
  args: { channelId: v.id("channels") },
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx, { channelId }) => {
    // Soft variant: the settings panel unmounts asynchronously, so a channel
    // the caller has just left (or that was deleted under them) should read as
    // "no preferences" rather than throw.
    const access = await checkChannelAccess(ctx, channelId);
    if (!access) return null;
    const { userId } = access;

    return await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
      .unique();
  },
});

export const save = mutation({
  args: {
    channelId: v.id("channels"),
    chatMention: v.boolean(),
    chatChannelMessage: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { channelId, ...prefs }) => {
    const { userId } = await requireChannelAccess(ctx, channelId);

    const existing = await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, prefs);
    } else {
      await ctx.db.insert("channelNotificationPreferences", { userId, channelId, ...prefs });
    }

    return null;
  },
});

export const getForUsersInChannel = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    channelId: v.id("channels"),
  },
  returns: v.array(v.union(preferencesValidator, v.null())),
  handler: async (ctx, { userIds, channelId }) => {
    return await Promise.all(
      userIds.map((userId) =>
        ctx.db
          .query("channelNotificationPreferences")
          .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
          .unique(),
      ),
    );
  },
});

export const removeByChannel = internalMutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, { channelId }) => {
    const rows = await ctx.db
      .query("channelNotificationPreferences")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return null;
  },
});
