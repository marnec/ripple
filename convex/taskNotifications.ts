"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import * as webpush from "web-push";

const getTaskRef = makeFunctionReference<
  "query",
  { taskId: Id<"tasks"> }
>("tasks:get");

const usersSubscriptionsRef = makeFunctionReference<
  "query",
  { usersIds: Id<"users">[] }
>("pushSubscription:usersSubscriptions");

/**
 * Send push notification when a user is assigned to a task
 */
export const notifyTaskAssignment = internalAction({
  args: {
    taskId: v.id("tasks"),
    assigneeId: v.id("users"),
    taskTitle: v.string(),
    assignedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, assigneeId, taskTitle, assignedBy }) => {
    // Get task to build URL
    const task = await ctx.runQuery(getTaskRef, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for assignment notification`);
      return null;
    }

    // Build notification payload
    const notification = JSON.stringify({
      title: `${assignedBy.name} assigned you a task`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    // Get assignee's push subscriptions
    const subscriptions = await ctx.runQuery(usersSubscriptionsRef, {
      usersIds: [assigneeId],
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

    // Send to all assignee's subscriptions
    await Promise.allSettled(
      subscriptions.map(async (subscription: any) => {
        const { endpoint, expirationTime, keys } = subscription;
        const id = endpoint.split("/").at(-1);

        return webpush
          .sendNotification({ endpoint, expirationTime, keys }, notification, notificationOptions)
          .then(() => {
            console.info(`Successfully sent task assignment notification to endpoint ID=${id}`);
          })
          .catch((error: { message: string }) => {
            console.error(
              `Failed to send task assignment notification to endpoint=${id}, err=${error.message}`,
            );
          });
      }),
    );

    return null;
  },
});

/**
 * Send push notification when users are @mentioned in task description or comment
 */
export const notifyUserMentions = internalAction({
  args: {
    taskId: v.id("tasks"),
    mentionedUserIds: v.array(v.string()),
    taskTitle: v.string(),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
    context: v.union(v.literal("task description"), v.literal("comment")),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, mentionedUserIds, taskTitle, mentionedBy, context }) => {
    // Get task to build URL
    const task = await ctx.runQuery(getTaskRef, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for mention notification`);
      return null;
    }

    // Build notification payload
    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you`,
      body: `In ${context} for: ${taskTitle}`,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    // Get mentioned users' push subscriptions
    // Note: mentionedUserIds are strings from JSON parsing, cast to Id array
    const subscriptions = await ctx.runQuery(usersSubscriptionsRef, {
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
            console.info(`Successfully sent mention notification to endpoint ID=${id}`);
          })
          .catch((error: { message: string }) => {
            console.error(
              `Failed to send mention notification to endpoint=${id}, err=${error.message}`,
            );
          });
      }),
    );

    return null;
  },
});
