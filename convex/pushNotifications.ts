"use node";

import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { action } from "./_generated/server";
import * as webpush from "web-push";

export const sendPushNotification = action({
  args: {
    channelId: v.id("channels"),
    body: v.string(),
    author: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { author, body, channelId }) => {
    const channel = await ctx.runQuery(internal.channels.getInternal, { id: channelId });

    if (!channel) throw new ConvexError(`Could not find channel=${channelId}`);

    const notification = JSON.stringify({
      title: author.name,
      body,
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!subject || !publicKey || !privateKey) {
      throw new ConvexError("Missing required VAPID variables from environment");
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

    // when channelMembers will be done, I'll need to filter users by channel
    // for now I'll filter them by workspace
    const workspaceUsers: { userId: Doc<"users">["_id"] }[] = await ctx.runQuery(
      api.workspaceMembers.byWorkspace,
      {
        workspaceId: channel?.workspaceId,
      },
    );

    const workspaceSubscriptions: Doc<"pushSubscriptions">[] = await ctx.runQuery(
      api.pushSubscription.usersSubscriptions,
      {
        usersIds: workspaceUsers
          .map(({ userId }) => userId)
          .filter((userId) => userId !== author.id),
      },
    );

    await Promise.allSettled(
      workspaceSubscriptions.map(async (subscription) => {
        const { endpoint, expirationTime, keys } = subscription;
        const id = endpoint.split("/").at(-1);

        return webpush
          .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
          .then(() => {
            console.info(`Successfully sent notification to endpoint ID=${id}`);
          })
          .catch((error: { message: string }) => {
            console.info(
              `An error occurred while sending notification to endpoint=${id}, err=${error.message}`,
            );
          });
      }),
    );
    return null;
  },
});
