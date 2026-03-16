"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";

/**
 * Send push notification when users are @mentioned in a document.
 * Called via scheduler from the reportDocumentMention mutation.
 */
export const notifyDocumentMention = internalAction({
  args: {
    documentId: v.id("documents"),
    documentName: v.string(),
    workspaceId: v.id("workspaces"),
    mentionedUserIds: v.array(v.string()),
    mentionedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { documentId, documentName, workspaceId, mentionedUserIds, mentionedBy }) => {
    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you in a document`,
      body: documentName,
      data: {
        url: `/workspaces/${workspaceId}/documents/${documentId}`,
      },
    });

    await sendPushToFilteredUsers(ctx, mentionedUserIds, "documentMention", notification);

    return null;
  },
});
