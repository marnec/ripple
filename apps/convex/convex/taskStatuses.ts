import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { taskStatusValidator } from "./validators";
import { requireWorkspaceMember } from "./authHelpers";
import { scheduleTaskReassign } from "./taskReassignPool";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(taskStatusValidator),
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    const statuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
      .collect();

    return statuses.filter((s) => s.pendingDeletion !== true);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    isCompleted: v.boolean(),
    setsStartDate: v.optional(v.boolean()),
  },
  returns: v.id("taskStatuses"),
  handler: async (ctx, { projectId, name, color, isCompleted, setsStartDate }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    // Calculate next order number (max existing order + 1)
    const existingStatuses = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const maxOrder = existingStatuses.reduce((max, status) => Math.max(max, status.order), -1);

    // isDefault always false for user-created statuses
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name,
      color,
      order: maxOrder + 1,
      isDefault: false,
      isCompleted,
      setsStartDate: setsStartDate ?? false,
    });

    return statusId;
  },
});

export const update = mutation({
  args: {
    statusId: v.id("taskStatuses"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
    setsStartDate: v.optional(v.boolean()),
    isCompleted: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { statusId, name, color, order, setsStartDate, isCompleted }) => {
    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    // Build patch object with only provided fields
    const patch: { name?: string; color?: string; order?: number; setsStartDate?: boolean; isCompleted?: boolean } = {};
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    if (order !== undefined) patch.order = order;
    if (setsStartDate !== undefined) patch.setsStartDate = setsStartDate;
    if (isCompleted !== undefined) patch.isCompleted = isCompleted;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(statusId, patch);
    }

    // When toggling isCompleted, bulk-update all tasks in this status
    if (isCompleted !== undefined) {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", status.projectId).eq("statusId", statusId)
        )
        .collect();
      await Promise.all(
        tasks.map((task) => ctx.db.patch(task._id, { completed: isCompleted }))
      );
    }

    return null;
  },
});

export const reorderColumns = mutation({
  args: {
    statusIds: v.array(v.id("taskStatuses")),
  },
  returns: v.null(),
  handler: async (ctx, { statusIds }) => {
    // Validate all statuses exist and belong to same project
    if (statusIds.length === 0) return null;

    const firstStatus = await ctx.db.get(statusIds[0]);
    if (!firstStatus) throw new ConvexError("Status not found");

    const project = await ctx.db.get(firstStatus.projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    // Reassign order values sequentially
    for (let i = 0; i < statusIds.length; i++) {
      await ctx.db.patch(statusIds[i], { order: i });
    }

    return null;
  },
});

export const remove = mutation({
  args: {
    statusId: v.id("taskStatuses"),
    reassignToStatusId: v.id("taskStatuses"),
  },
  returns: v.null(),
  handler: async (ctx, { statusId, reassignToStatusId }) => {
    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    if (status.isDefault) {
      throw new ConvexError("Cannot remove the default status");
    }
    if (status.pendingDeletion) {
      throw new ConvexError("Status deletion already in progress");
    }
    if (reassignToStatusId === statusId) {
      throw new ConvexError("Cannot reassign tasks to the status being deleted");
    }

    const target = await ctx.db.get(reassignToStatusId);
    if (!target) throw new ConvexError("Target status not found");
    if (target.projectId !== status.projectId) {
      throw new ConvexError("Target status belongs to a different project");
    }
    if (target.pendingDeletion) {
      throw new ConvexError("Target status is being deleted");
    }

    await ctx.db.patch(statusId, { pendingDeletion: true });

    await scheduleTaskReassign(ctx, internal.taskStatuses.reassignTasksAndDelete, {
      statusId,
      reassignToStatusId,
    });

    return null;
  },
});

const REASSIGN_BATCH_SIZE = 100;

export const fetchTasksForStatusBatch = internalMutation({
  args: {
    statusId: v.id("taskStatuses"),
    reassignToStatusId: v.id("taskStatuses"),
    limit: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, { statusId, reassignToStatusId, limit }) => {
    const status = await ctx.db.get(statusId);
    if (!status) return 0;

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", status.projectId).eq("statusId", statusId)
      )
      .take(limit);

    await Promise.all(
      tasks.map((task) =>
        ctx.db.patch(task._id, { statusId: reassignToStatusId })
      )
    );

    return tasks.length;
  },
});

export const finalizeStatusDelete = internalMutation({
  args: { statusId: v.id("taskStatuses") },
  returns: v.null(),
  handler: async (ctx, { statusId }) => {
    const status = await ctx.db.get(statusId);
    if (!status) return null;
    await ctx.db.delete(statusId);
    return null;
  },
});

export const reassignTasksAndDelete = internalAction({
  args: {
    statusId: v.id("taskStatuses"),
    reassignToStatusId: v.id("taskStatuses"),
  },
  returns: v.null(),
  handler: async (ctx, { statusId, reassignToStatusId }) => {
    // Drain in batches to keep individual mutations small. Each batch
    // patches `statusId`, so the next take() returns the next chunk and
    // the loop terminates when zero rows are left.
    while (true) {
      const moved: number = await ctx.runMutation(
        internal.taskStatuses.fetchTasksForStatusBatch,
        { statusId, reassignToStatusId, limit: REASSIGN_BATCH_SIZE },
      );
      if (moved === 0) break;
    }

    await ctx.runMutation(internal.taskStatuses.finalizeStatusDelete, { statusId });
    return null;
  },
});
