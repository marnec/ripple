"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";

/**
 * Send push notification for new channel messages to workspace members.
 * Converted from public action to internalAction (should not be client-callable).
 */
export const sendPushNotification = internalAction({
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
    if (!channel) {
      console.error(`Channel ${channelId} not found for push notification`);
      return null;
    }

    const notification = JSON.stringify({
      title: author.name,
      body,
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    const memberIds = await ctx.runQuery(
      internal.workspaceMembers.listUserIds,
      { workspaceId: channel.workspaceId },
    );

    const recipientIds = memberIds.filter((id) => id !== author.id);

    await sendPushToFilteredUsers(ctx, recipientIds, "chatChannelMessage", notification, channelId);

    return null;
  },
});
