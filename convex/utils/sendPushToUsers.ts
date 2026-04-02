"use node";

import * as webpush from "web-push";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { NotificationCategory } from "@shared/notificationCategories";
import type { Id } from "../_generated/dataModel";

/**
 * Fetch push subscriptions for the given user IDs (via internal query)
 * and deliver the notification. No preference filtering — the caller
 * has already resolved who should receive the notification.
 */
export async function sendPushToUsers(
  ctx: ActionCtx,
  userIds: (string | Id<"users">)[],
  notification: string,
): Promise<void> {
  if (userIds.length === 0) return;

  const subscriptions = await ctx.runQuery(
    internal.notificationDelivery.getUserPushSubscriptions,
    { userIds: userIds.map(String) },
  );

  if (subscriptions.length === 0) return;
  await deliverToEndpoints(ctx, subscriptions, notification);
}

/**
 * Send push notifications to a list of users, respecting their
 * notification preferences for the given category.
 *
 * Uses a single consolidated query (notificationDelivery.getFilteredSubscriptions)
 * that resolves preferences AND subscriptions in one round-trip.
 * For project/channel scoped categories, preference lookup uses a resource-level
 * index (by_project / by_channel) — O(1) queries regardless of recipient count.
 *
 * Used only for the targeted-recipient path (mentions, assignee).
 * Broadcast notifications use the subscription table and sendPushToUsers instead.
 */
export async function sendPushToFilteredUsers(
  ctx: ActionCtx,
  userIds: (string | Id<"users">)[],
  category: NotificationCategory,
  notification: string,
  resourceId?: Id<"projects"> | Id<"channels">,
): Promise<void> {
  if (userIds.length === 0) return;

  // Single query: filter by preferences + fetch subscriptions
  const subscriptions = await ctx.runQuery(
    internal.notificationDelivery.getFilteredSubscriptions,
    {
      recipientIds: userIds.map(String),
      category,
      resourceId: resourceId as string | undefined,
    },
  );

  if (subscriptions.length === 0) return;
  await deliverToEndpoints(ctx, subscriptions, notification, category);
}

// ── Shared push delivery ────────────────────────────────────────────

type PushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

async function deliverToEndpoints(
  ctx: ActionCtx,
  subscriptions: PushSubscription[],
  notification: string,
  label?: string,
): Promise<void> {
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

  const tag = label ?? "push";
  const staleEndpoints: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const { endpoint, expirationTime, keys } = subscription;
      const id = endpoint.split("/").at(-1);

      return webpush
        .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
        .then(() => {
          console.info(`Successfully sent ${tag} notification to endpoint ID=${id}`);
        })
        .catch((error: { statusCode?: number; message: string }) => {
          console.error(`Failed to send ${tag} notification to endpoint=${id}, status=${error.statusCode}, err=${error.message}`);
          if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 403) {
            staleEndpoints.push(endpoint);
          }
        });
    }),
  );

  if (staleEndpoints.length > 0) {
    await ctx.runMutation(internal.pushSubscription.removeStaleEndpoints, {
      endpoints: staleEndpoints,
    });
  }
}
