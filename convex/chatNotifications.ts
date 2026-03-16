"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";

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
    const channel = await ctx.runQuery(internal.channels.getInternal, { id: channelId });
    if (!channel) {
      console.error(`Channel ${channelId} not found for mention notification`);
      return null;
    }

    const body = plainText.length > 100 ? plainText.slice(0, 97) + "..." : plainText;

    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you in #${channel.name}`,
      body,
      data: {
        url: `/workspaces/${channel.workspaceId}/channels/${channelId}`,
      },
    });

    await sendPushToFilteredUsers(ctx, mentionedUserIds, "chatMention", notification, channelId);

    return null;
  },
});
