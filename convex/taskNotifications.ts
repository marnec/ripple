"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendPushToFilteredUsers } from "./utils/sendPushToUsers";

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
    const task = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for assignment notification`);
      return null;
    }

    const notification = JSON.stringify({
      title: `${assignedBy.name} assigned you a task`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    await sendPushToFilteredUsers(ctx, [assigneeId], "taskAssigned", notification, task.projectId);

    return null;
  },
});

/**
 * Send push notification when users are @mentioned in task description or comment.
 * Uses separate preference categories for description vs comment mentions.
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
    const task = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for mention notification`);
      return null;
    }

    const notification = JSON.stringify({
      title: `${mentionedBy.name} mentioned you`,
      body: `In ${context} for: ${taskTitle}`,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    const category = context === "task description" ? "taskDescriptionMention" : "taskCommentMention";
    await sendPushToFilteredUsers(ctx, mentionedUserIds, category, notification, task.projectId);

    return null;
  },
});

/**
 * Send push notification when someone comments on a task you're assigned to
 */
export const notifyTaskComment = internalAction({
  args: {
    taskId: v.id("tasks"),
    assigneeId: v.id("users"),
    taskTitle: v.string(),
    commentedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, assigneeId, taskTitle, commentedBy }) => {
    const task = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for comment notification`);
      return null;
    }

    const notification = JSON.stringify({
      title: `${commentedBy.name} commented on your task`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    await sendPushToFilteredUsers(ctx, [assigneeId], "taskComment", notification, task.projectId);

    return null;
  },
});

/**
 * Send push notification when a task's status changes (to assignee)
 */
export const notifyTaskStatusChange = internalAction({
  args: {
    taskId: v.id("tasks"),
    assigneeId: v.id("users"),
    taskTitle: v.string(),
    newStatusName: v.string(),
    changedBy: v.object({
      name: v.string(),
      id: v.id("users"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, assigneeId, taskTitle, newStatusName, changedBy }) => {
    const task = await ctx.runQuery(internal.tasks.getInternal, { taskId });
    if (!task) {
      console.error(`Task ${taskId} not found for status change notification`);
      return null;
    }

    const notification = JSON.stringify({
      title: `${changedBy.name} changed task status to ${newStatusName}`,
      body: taskTitle,
      data: {
        url: `/workspaces/${task.workspaceId}/projects/${task.projectId}?task=${taskId}`,
      },
    });

    await sendPushToFilteredUsers(ctx, [assigneeId], "taskStatusChange", notification, task.projectId);

    return null;
  },
});
