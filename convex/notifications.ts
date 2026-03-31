"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";
import type { NotificationCategory } from "@shared/notificationCategories";

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
    /** Explicit recipients (mentions, assignee). Mutually exclusive with workspaceId. */
    recipientIds: v.optional(v.array(v.string())),
    /** Broadcast: fetch all workspace members, exclude sender. */
    workspaceId: v.optional(v.id("workspaces")),
    /** Per-resource preference scope (projectId or channelId). */
    resourceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let recipientIds: string[];

    if (args.recipientIds) {
      recipientIds = args.recipientIds;
    } else if (args.workspaceId) {
      const memberIds = await ctx.runQuery(
        internal.workspaceMembers.listUserIds,
        { workspaceId: args.workspaceId },
      );
      recipientIds = memberIds.filter((id) => id !== args.senderId);
    } else {
      return null;
    }

    if (recipientIds.length === 0) return null;

    const notification = JSON.stringify({
      title: args.title,
      body: args.body,
      data: { url: args.url },
    });

    await sendPushToFilteredUsers(
      ctx,
      recipientIds,
      args.category as NotificationCategory,
      notification,
      args.resourceId as any,
    );

    return null;
  },
});
