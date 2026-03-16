"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";
import type { NotificationCategory } from "@shared/notificationCategories";

const resourceTypeToCategory: Record<string, { created: NotificationCategory; deleted: NotificationCategory }> = {
  document: { created: "documentCreated", deleted: "documentDeleted" },
  spreadsheet: { created: "spreadsheetCreated", deleted: "spreadsheetDeleted" },
  diagram: { created: "diagramCreated", deleted: "diagramDeleted" },
  project: { created: "projectCreated", deleted: "projectDeleted" },
  channel: { created: "channelCreated", deleted: "channelDeleted" },
};

/**
 * Notify workspace members when a resource is created or deleted.
 */
export const notifyResourceEvent = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: v.union(
      v.literal("document"),
      v.literal("spreadsheet"),
      v.literal("diagram"),
      v.literal("project"),
      v.literal("channel"),
    ),
    resourceName: v.string(),
    event: v.union(v.literal("created"), v.literal("deleted")),
    triggeredBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
    url: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, resourceType, resourceName, event, triggeredBy, url }) => {
    const mapping = resourceTypeToCategory[resourceType];
    if (!mapping) {
      console.error(`Unknown resource type: ${resourceType}`);
      return null;
    }

    const category = event === "created" ? mapping.created : mapping.deleted;

    const notification = JSON.stringify({
      title: `${triggeredBy.name} ${event} a ${resourceType}`,
      body: resourceName,
      data: { url: url ?? `/workspaces/${workspaceId}` },
    });

    // Get all workspace members excluding the triggering user
    const memberIds = await ctx.runQuery(
      internal.workspaceMembers.listUserIds,
      { workspaceId },
    );
    const recipientIds = memberIds.filter((id) => id !== triggeredBy.id);

    await sendPushToFilteredUsers(ctx, recipientIds, category, notification);

    return null;
  },
});
