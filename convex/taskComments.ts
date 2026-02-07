import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAll } from "convex-helpers/server/relationships";
import { extractMentionedUserIds } from "./utils/blocknote";
import { getUserDisplayName } from "@shared/displayName";

export const list = query({
  args: { taskId: v.id("tasks") },
  returns: v.any(),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get task to check project membership
    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Check project membership via projectMembers.by_project_user index
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get task to check project membership
    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Check project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

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
    if (filteredMentions.length > 0) {
      const user = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyUserMentions, {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Update body with trimmed value
    await ctx.db.patch(id, { body: body.trim() });

    // Schedule mention notifications for newly added mentions after database write
    const oldMentions = new Set(comment.body ? extractMentionedUserIds(comment.body) : []);
    const newMentions = extractMentionedUserIds(body);
    const addedMentions = newMentions.filter(id => !oldMentions.has(id) && id !== userId);
    if (addedMentions.length > 0) {
      const task = await ctx.db.get(comment.taskId);
      const user = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyUserMentions, {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Get comment
    const comment = await ctx.db.get(id);
    if (!comment) throw new ConvexError("Comment not found");

    // Author-only check
    if (comment.userId !== userId) {
      throw new ConvexError("Not authorized");
    }

    // Soft delete
    await ctx.db.patch(id, { deleted: true });
    return null;
  },
});
