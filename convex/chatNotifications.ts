"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import * as webpush from "web-push";

/**
 * Send push notification when users are @mentioned in chat messages
 */
export const notifyMessageMentions = internalAction({
  args: {
    mentionedUserIds: v.array(v.string()),
    channelId: v.id("channels"),
    plainText: v.string(),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { mentionedUserIds, channelId, plainText, mentionedBy }) => {
    // Get channel to build notification
    const channel = await ctx.runQuery(internal.channels.getInternal, { id: channelId });
    if (!channel) {
      console.error(`Channel ${channelId} not found for mention notification`);
      return null;
    }

    // Truncate plainText for notification body
    const body = plainText.length > 100 ? plainText.slice(0, 97) + "..." : plainText;

    // Build notification payload
    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you in #${channel.name}`,
      body,
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    // Get mentioned users' push subscriptions
    const subscriptions = await ctx.runQuery(api.pushSubscription.usersSubscriptions, {
      usersIds: mentionedUserIds as any,
    });

    // Setup VAPID credentials
    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
      console.error("Missing VAPID environment variables - cannot send push notifications");
      return null;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const notificationOptions = {
      TTL: 10000,
      vapidDetails: {
        subject,
        publicKey,
        privateKey,
      },
    };

    // Send to all mentioned users' subscriptions
    await Promise.allSettled(
      subscriptions.map(async (subscription: any) => {
        const { endpoint, expirationTime, keys } = subscription;
        const id = endpoint.split("/").at(-1);

        return webpush
          .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
          .then(() => {
            console.info(`Successfully sent chat mention notification to endpoint ID=${id}`);
          })
          .catch((error: { message: string }) => {
            console.error(
              `Failed to send chat mention notification to endpoint=${id}, err=${error.message}`,
            );
          });
      }),
    );

    return null;
  },
});
