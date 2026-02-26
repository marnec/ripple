import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAll } from "convex-helpers/server/relationships";
import { getUserDisplayName } from "@shared/displayName";
import { Id } from "./_generated/dataModel";

// Helper to insert activity from within any mutation handler.
// Import and call directly — Convex mutations can't call other mutations.
export async function insertActivity(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    userId: Id<"users">;
    type:
      | "created"
      | "status_change"
      | "priority_change"
      | "assignee_change"
      | "label_add"
      | "label_remove"
      | "title_change"
      | "due_date_change"
      | "start_date_change"
      | "estimate_change"
      | "dependency_add"
      | "dependency_remove"
      | "comment_edit"
      | "comment_delete";
    oldValue?: string;
    newValue?: string;
  },
) {
  await ctx.db.insert("taskActivity", {
    taskId: args.taskId,
    userId: args.userId,
    type: args.type,
    oldValue: args.oldValue,
    newValue: args.newValue,
  });
}

// Returns a merged timeline of activity events and comments, sorted chronologically.
export const timeline = query({
  args: { taskId: v.id("tasks") },
  returns: v.any(),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Auth: workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Fetch activity entries
    const activities = await ctx.db
      .query("taskActivity")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .order("asc")
      .collect();

    // Fetch undeleted comments
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("undeleted_by_task", (q) =>
        q.eq("taskId", taskId).eq("deleted", false)
      )
      .order("asc")
      .collect();

    // Collect all user IDs for batch enrichment
    const allUserIds = [
      ...new Set([
        ...activities.map((a) => a.userId),
        ...comments.map((c) => c.userId),
      ]),
    ];
    const users = await getAll(ctx.db, allUserIds);
    const userMap = new Map(
      users.map((u, i) => [allUserIds[i], u]),
    );

    // Build unified timeline items
    const activityItems = activities.map((a) => {
      const user = userMap.get(a.userId);
      return {
        kind: "activity" as const,
        _id: a._id,
        _creationTime: a._creationTime,
        userId: a.userId,
        userName: getUserDisplayName(user),
        userImage: user?.image,
        type: a.type,
        oldValue: a.oldValue,
        newValue: a.newValue,
      };
    });

    const commentItems = comments.map((c) => {
      const user = userMap.get(c.userId);
      return {
        kind: "comment" as const,
        _id: c._id,
        _creationTime: c._creationTime,
        userId: c.userId,
        userName: getUserDisplayName(user),
        userImage: user?.image,
        commentId: c._id,
        body: c.body,
      };
    });

    // Merge and sort by creation time
    const timeline = [...activityItems, ...commentItems].sort(
      (a, b) => a._creationTime - b._creationTime,
    );

    return timeline;
  },
});
