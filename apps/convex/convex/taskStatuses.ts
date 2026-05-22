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
    // GitHub integration: when the task closes via outbound sync, this drives
    // the `state_reason` value pushed to GitHub. Null clears the override.
    externalCloseReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned"), v.null()),
    ),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { statusId, name, color, order, setsStartDate, isCompleted, externalCloseReason },
  ) => {
    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    // A triage inbox holds freshly-imported (open) issues — it can't double as
    // a "completed" bucket. The matrix disables this client-side; guard here too.
    if (isCompleted === true && status.isTriage) {
      throw new ConvexError("The triage inbox can't be marked completed");
    }

    // Build patch object with only provided fields
    const patch: {
      name?: string;
      color?: string;
      order?: number;
      setsStartDate?: boolean;
      isCompleted?: boolean;
      externalCloseReason?: "completed" | "not_planned" | undefined;
    } = {};
    if (name !== undefined) patch.name = name;
    if (color !== undefined) patch.color = color;
    if (order !== undefined) patch.order = order;
    if (setsStartDate !== undefined) patch.setsStartDate = setsStartDate;
    if (isCompleted !== undefined) patch.isCompleted = isCompleted;
    if (externalCloseReason !== undefined) {
      // null on the wire → undefined in the patch → removes the field.
      patch.externalCloseReason = externalCloseReason ?? undefined;
    }

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

/**
 * Assign a "singleton" status effect — one that at most one status per project
 * may hold. `default` is the landing status for new tasks (exactly one,
 * required); `triage` is the inbox for externally-ingested issues (at most
 * one, optional). Setting an effect clears the previous holder in the same
 * mutation so the UI never has to remove the old one first.
 *
 * This is the user-facing writer for `isTriage`; the integration layer remains
 * the only writer that *places tasks* into a triage status, but designating
 * which status serves as triage now happens here (via the Status Effect
 * Matrix in project settings).
 */
export const setSingletonEffect = mutation({
  args: {
    statusId: v.id("taskStatuses"),
    effect: v.union(v.literal("default"), v.literal("triage")),
    value: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { statusId, effect, value }) => {
    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    const project = await ctx.db.get(status.projectId);
    if (!project) throw new ConvexError("Project not found");
    await requireWorkspaceMember(ctx, project.workspaceId);

    if (effect === "default") {
      if (!value) {
        throw new ConvexError("A project must always have a default status");
      }
      if (status.isTriage) {
        throw new ConvexError(
          "The triage inbox can't also be the default status",
        );
      }
      if (status.isDefault) return null; // already the default

      const current = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project_isDefault", (q) =>
          q.eq("projectId", status.projectId).eq("isDefault", true),
        )
        .collect();
      await Promise.all(
        current
          .filter((s) => s._id !== statusId)
          .map((s) => ctx.db.patch(s._id, { isDefault: false })),
      );
      await ctx.db.patch(statusId, { isDefault: true });
      return null;
    }

    // effect === "triage"
    if (!value) {
      await ctx.db.patch(statusId, { isTriage: false });
      return null;
    }
    if (status.isDefault) {
      throw new ConvexError(
        "The default status can't also be the triage inbox",
      );
    }
    if (status.isCompleted) {
      throw new ConvexError(
        "A completed status can't be the triage inbox",
      );
    }
    const currentTriage = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_isTriage", (q) =>
        q.eq("projectId", status.projectId).eq("isTriage", true),
      )
      .collect();
    await Promise.all(
      currentTriage
        .filter((s) => s._id !== statusId)
        .map((s) => ctx.db.patch(s._id, { isTriage: false })),
    );
    await ctx.db.patch(statusId, { isTriage: true });
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

    // Deliberately does NOT apply the canonical status side-effects: deleting
    // a column and relocating its tasks must PRESERVE their `completed` flag
    // (and work periods) — re-syncing would resurrect finished work as active
    // when reassigning a "Done" status into a non-completed one.
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
