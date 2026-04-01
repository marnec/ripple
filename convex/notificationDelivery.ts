import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { NotificationCategory } from "@shared/notificationCategories";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROJECT_TASK_PREFERENCES,
  DEFAULT_CHANNEL_CHAT_PREFERENCES,
  isTaskCategory,
  isChatCategory,
} from "@shared/notificationCategories";

const subscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.union(v.number(), v.null()),
  keys: v.object({
    p256dh: v.string(),
    auth: v.string(),
  }),
});

/**
 * Single query that resolves preferences AND subscriptions for a set of
 * recipient user IDs. Returns only the push subscriptions for users who
 * have the given category enabled.
 *
 * Replaces the previous 2-query pattern:
 *   1. getForUsers / getForUsersInProject / getForUsersInChannel  (N index lookups)
 *   2. usersSubscriptions                                         (N index lookups)
 *
 * For project/channel scoped categories, uses the resource-level index
 * (by_project / by_channel) to fetch ALL overrides in a single .collect()
 * instead of N per-user lookups.
 */
export const getFilteredSubscriptions = internalQuery({
  args: {
    recipientIds: v.array(v.string()),
    category: v.string(),
    resourceId: v.optional(v.string()),
  },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, { recipientIds, category, resourceId }) => {
    const cat = category as NotificationCategory;
    const userIds = recipientIds as Id<"users">[];

    // ── Step 1: Determine which users have this category enabled ─────
    let enabledUserIds: Id<"users">[];

    if (resourceId && isTaskCategory(cat)) {
      // Single .collect() on by_project index — O(1) queries regardless of N
      const allOverrides = await ctx.db
        .query("projectNotificationPreferences")
        .withIndex("by_project", (q) => q.eq("projectId", resourceId as Id<"projects">))
        .collect();
      const overrideMap = new Map(allOverrides.map((p) => [p.userId, p]));

      enabledUserIds = userIds.filter((uid) => {
        const prefs = overrideMap.get(uid);
        if (!prefs) return DEFAULT_PROJECT_TASK_PREFERENCES[cat];
        return prefs[cat];
      });
    } else if (resourceId && isChatCategory(cat)) {
      // Single .collect() on by_channel index — O(1) queries regardless of N
      const allOverrides = await ctx.db
        .query("channelNotificationPreferences")
        .withIndex("by_channel", (q) => q.eq("channelId", resourceId as Id<"channels">))
        .collect();
      const overrideMap = new Map(allOverrides.map((p) => [p.userId, p]));

      enabledUserIds = userIds.filter((uid) => {
        const prefs = overrideMap.get(uid);
        if (!prefs) return DEFAULT_CHANNEL_CHAT_PREFERENCES[cat];
        return prefs[cat];
      });
    } else {
      // Global preferences — no resource-scoped index, use parallel index lookups
      const prefsResults = await Promise.all(
        userIds.map((uid) =>
          ctx.db
            .query("notificationPreferences")
            .withIndex("by_user", (q) => q.eq("userId", uid))
            .unique(),
        ),
      );
      enabledUserIds = userIds.filter((_, i) => {
        const prefs = prefsResults[i];
        if (!prefs) return DEFAULT_PREFERENCES[cat];
        return prefs[cat as keyof typeof prefs];
      });
    }

    if (enabledUserIds.length === 0) return [];

    // ── Step 2: Fetch push subscriptions for enabled users ───────────
    const subscriptions = (
      await Promise.all(
        enabledUserIds.map((uid) =>
          ctx.db
            .query("pushSubscriptions")
            .withIndex("by_user", (q) => q.eq("userId", uid))
            .collect(),
        ),
      )
    ).flat();

    return subscriptions.map((s) => ({
      endpoint: s.endpoint,
      expirationTime: s.expirationTime,
      keys: s.keys,
    }));
  },
});
