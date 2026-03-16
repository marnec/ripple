"use node";

import * as webpush from "web-push";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { NotificationCategory } from "@shared/notificationCategories";
import { DEFAULT_PREFERENCES, DEFAULT_PROJECT_TASK_PREFERENCES, DEFAULT_CHANNEL_CHAT_PREFERENCES, isTaskCategory, isChatCategory } from "@shared/notificationCategories";
import type { Id } from "../_generated/dataModel";

/**
 * Send push notifications to a filtered list of users, respecting their
 * notification preferences for the given category.
 */
export async function sendPushToFilteredUsers(
  ctx: ActionCtx,
  userIds: (string | Id<"users">)[],
  category: NotificationCategory,
  notification: string,
  resourceId?: Id<"projects"> | Id<"channels">,
): Promise<void> {
  if (userIds.length === 0) return;

  const typedIds = userIds as Id<"users">[];

  let enabledUserIds: Id<"users">[];

  if (resourceId && isTaskCategory(category)) {
    // Use per-project preferences for task categories
    const projPrefsArray = await ctx.runQuery(
      internal.projectNotificationPreferences.getForUsersInProject,
      { userIds: typedIds, projectId: resourceId as Id<"projects"> },
    );
    enabledUserIds = typedIds.filter((_, i) => {
      const prefs = projPrefsArray[i];
      if (!prefs) return DEFAULT_PROJECT_TASK_PREFERENCES[category];
      return prefs[category];
    });
  } else if (resourceId && isChatCategory(category)) {
    // Use per-channel preferences for chat categories
    const chanPrefsArray = await ctx.runQuery(
      internal.channelNotificationPreferences.getForUsersInChannel,
      { userIds: typedIds, channelId: resourceId as Id<"channels"> },
    );
    enabledUserIds = typedIds.filter((_, i) => {
      const prefs = chanPrefsArray[i];
      if (!prefs) return DEFAULT_CHANNEL_CHAT_PREFERENCES[category];
      return prefs[category];
    });
  } else {
    // Use global preferences
    const prefsArray = await ctx.runQuery(
      internal.notificationPreferences.getForUsers,
      { userIds: typedIds },
    );
    enabledUserIds = typedIds.filter((_, i) => {
      const prefs = prefsArray[i];
      if (!prefs) return DEFAULT_PREFERENCES[category];
      return prefs[category];
    });
  }

  if (enabledUserIds.length === 0) return;

  // Fetch push subscriptions for enabled users
  const subscriptions = await ctx.runQuery(
    internal.pushSubscription.usersSubscriptions,
    { usersIds: enabledUserIds },
  );

  if (subscriptions.length === 0) return;

  // Setup VAPID credentials
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    console.error("Missing VAPID environment variables - cannot send push notifications");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const notificationOptions = {
    TTL: 10000,
    vapidDetails: { subject, publicKey, privateKey },
  };

  await Promise.allSettled(
    subscriptions.map(async (subscription: { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } }) => {
      const { endpoint, expirationTime, keys } = subscription;
      const id = endpoint.split("/").at(-1);

      return webpush
        .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
        .then(() => {
          console.info(`Successfully sent ${category} notification to endpoint ID=${id}`);
        })
        .catch((error: { message: string }) => {
          console.error(`Failed to send ${category} notification to endpoint=${id}, err=${error.message}`);
        });
    }),
  );
}
