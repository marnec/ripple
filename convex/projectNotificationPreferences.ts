import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const preferencesValidator = v.object({
  _id: v.id("projectNotificationPreferences"),
  _creationTime: v.number(),
  userId: v.id("users"),
  projectId: v.id("projects"),
  taskAssigned: v.boolean(),
  taskDescriptionMention: v.boolean(),
  taskCommentMention: v.boolean(),
  taskComment: v.boolean(),
  taskStatusChange: v.boolean(),
});

export const get = query({
  args: { projectId: v.id("projects") },
  returns: v.union(preferencesValidator, v.null()),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) return null;

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a workspace member");

    return await ctx.db
      .query("projectNotificationPreferences")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    taskAssigned: v.boolean(),
    taskDescriptionMention: v.boolean(),
    taskCommentMention: v.boolean(),
    taskComment: v.boolean(),
    taskStatusChange: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { projectId, ...prefs }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a workspace member");

    const existing = await ctx.db
      .query("projectNotificationPreferences")
      .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, prefs);
    } else {
      await ctx.db.insert("projectNotificationPreferences", { userId, projectId, ...prefs });
    }

    return null;
  },
});

export const getForUsersInProject = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    projectId: v.id("projects"),
  },
  returns: v.array(v.union(preferencesValidator, v.null())),
  handler: async (ctx, { userIds, projectId }) => {
    return await Promise.all(
      userIds.map((userId) =>
        ctx.db
          .query("projectNotificationPreferences")
          .withIndex("by_user_project", (q) => q.eq("userId", userId).eq("projectId", projectId))
          .unique(),
      ),
    );
  },
});

export const removeByProject = internalMutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, { projectId }) => {
    const rows = await ctx.db
      .query("projectNotificationPreferences")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return null;
  },
});
