"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers, sendPushToUsers } from "./utils/sendPushToUsers";
import type { NotificationCategory } from "@ripple/shared/notificationCategories";

/**
 * Unified push notification delivery action.
 * Replaces resourceNotifications, taskNotifications, chatNotifications,
 * documentNotifications, and pushNotifications modules.
 *
 * Receives pre-computed title/body/url from the caller (mutation) so it
 * never needs to re-fetch resources for context.
 */
export const deliverPush = internalAction({
  args: {
    senderId: v.id("users"),
    category: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    /** Explicit recipients (mentions, assignee). Mutually exclusive with scope. */
    recipientIds: v.optional(v.array(v.string())),
    /** Broadcast scope: workspaceId, channelId, or projectId. The subscription
     *  table is queried for (scope, category) to find recipients. */
    scope: v.optional(v.string()),
    /** Per-resource preference scope (projectId or channelId) — used only for
     *  the explicit-recipient path where preferences are checked at delivery. */
    resourceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let recipientIds: string[];

    if (args.recipientIds) {
      // Targeted notification (mentions, assignee) — small N, check prefs inline
      recipientIds = args.recipientIds;
    } else if (args.scope) {
      // Broadcast — use the materialized subscription table
      recipientIds = await ctx.runQuery(
        internal.notificationDelivery.getSubscribedUserIds,
        {
          scope: args.scope,
          category: args.category,
          excludeUserId: args.senderId,
        },
      );
    } else {
      return null;
    }

    if (recipientIds.length === 0) return null;

    const notification = JSON.stringify({
      title: args.title,
      body: args.body,
      data: { url: args.url },
    });

    if (args.recipientIds) {
      // Targeted: still filter by per-user preferences
      await sendPushToFilteredUsers(
        ctx,
        recipientIds,
        args.category as NotificationCategory,
        notification,
        args.resourceId as any,
      );
    } else {
      // Broadcast: preferences already resolved by subscription table,
      // just fetch push endpoints and send.
      await sendPushToUsers(ctx, recipientIds, notification);
    }

    return null;
  },
});
