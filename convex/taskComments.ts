import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAll } from "convex-helpers/server/relationships";
import { extractMentionedUserIds } from "./utils/blocknote";
import { getUserDisplayName } from "@shared/displayName";
import { logTaskActivity } from "./auditLog";
import { requireResourceMember, requireUser } from "./authHelpers";
import { scheduleNotification } from "./notificationPool";

export const list = query({
  args: { taskId: v.id("tasks") },
  returns: v.array(v.object({
    _id: v.id("taskComments"),
    _creationTime: v.number(),
    taskId: v.id("tasks"),
    userId: v.id("users"),
    body: v.string(),
    deleted: v.boolean(),
    author: v.string(),
    image: v.optional(v.string()),
  })),
  handler: async (ctx, { taskId }) => {
    await requireResourceMember(ctx, "tasks", taskId);

    // Query comments using undeleted_by_task index
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("undeleted_by_task", (q) =>
        q.eq("taskId", taskId).eq("deleted", false)
      )
      .order("asc") // chronological order (oldest first)
      .collect();

    // Batch fetch all authors
    const userIds = [...new Set(comments.map((c) => c.userId))];
    const users = await getAll(ctx.db, userIds);
    const userMap = new Map(users.map((u, i) => [userIds[i], u]));

    // Enrich comments with author info
    const enrichedComments = comments.map((comment) => {
      const user = userMap.get(comment.userId);
      return {
        ...comment,
        author: getUserDisplayName(user),
        image: user?.image,
      };
    });

    return enrichedComments;
  },
});

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    body: v.string(),
  },
  returns: v.id("taskComments"),
  handler: async (ctx, { taskId, body }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    // Insert comment
    const commentId = await ctx.db.insert("taskComments", {
      taskId,
      userId,
      body,
      deleted: false,
    });

    // Schedule mention notifications after database write
    const mentionedUserIds = extractMentionedUserIds(body);
    const filteredMentions = mentionedUserIds.filter(id => id !== userId);
    const user = await ctx.db.get(userId);

    if (filteredMentions.length > 0) {
      await scheduleNotification(ctx, internal.taskNotifications.notifyUserMentions, {
        taskId,
        mentionedUserIds: filteredMentions,
        taskTitle: task?.title ?? "a task",
        mentionedBy: {
          name: getUserDisplayName(user),
          id: userId,
        },
        context: "comment",
      });
    }

    // Notify assignee about new comment (if they're not the commenter and not already mentioned)
    if (task.assigneeId && task.assigneeId !== userId && !filteredMentions.includes(task.assigneeId)) {
      await scheduleNotification(ctx, internal.taskNotifications.notifyTaskComment, {
        taskId,
        assigneeId: task.assigneeId,
        taskTitle: task.title,
        commentedBy: {
          name: getUserDisplayName(user),
          id: userId,
        },
      });
    }

    return commentId;
  },
});

export const update = mutation({
  args: {
    id: v.id("taskComments"),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { id, body }) => {
    const userId = await requireUser(ctx);

    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Update body with trimmed value
    await ctx.db.patch(id, { body: body.trim() });

    // Log comment edit activity
    const taskDoc = await ctx.db.get(comment.taskId);
    await logTaskActivity(ctx, { taskId: comment.taskId, userId, workspaceId: taskDoc!.workspaceId, type: "comment_edit", taskTitle: taskDoc!.title });

    // Schedule mention notifications for newly added mentions after database write
    const oldMentions = new Set(comment.body ? extractMentionedUserIds(comment.body) : []);
    const newMentions = extractMentionedUserIds(body);
    const addedMentions = newMentions.filter(id => !oldMentions.has(id) && id !== userId);
    if (addedMentions.length > 0) {
      const task = await ctx.db.get(comment.taskId);
      const user = await ctx.db.get(userId);
      await scheduleNotification(ctx, internal.taskNotifications.notifyUserMentions, {
        taskId: comment.taskId,
        mentionedUserIds: addedMentions,
        taskTitle: task?.title ?? "a task",
        mentionedBy: {
          name: getUserDisplayName(user),
          id: userId,
        },
        context: "comment",
      });
    }

    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("taskComments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);

    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Soft delete
    await ctx.db.patch(id, { deleted: true });

    // Log comment delete activity
    const taskForScope = await ctx.db.get(comment.taskId);
    await logTaskActivity(ctx, { taskId: comment.taskId, userId, workspaceId: taskForScope!.workspaceId, type: "comment_delete", taskTitle: taskForScope!.title });

    return null;
  },
});
