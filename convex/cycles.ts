import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { logActivity } from "./auditLog";
import type { CycleStatus } from "@shared/types/cycles";
import { cycleStatusValidator, taskStatusValidator, userValidator } from "./validators";
import { baseTaskFields } from "./tasks";

const cycleWithProgressValidator = v.object({
  _id: v.id("cycles"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  workspaceId: v.id("workspaces"),
  name: v.string(),
  description: v.optional(v.string()),
  startDate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  status: cycleStatusValidator,
  creatorId: v.id("users"),
  totalTasks: v.number(),
  completedTasks: v.number(),
  progressPercent: v.number(),
});

const enrichedTaskValidator = v.object({
  ...baseTaskFields,
  startDate: v.optional(v.string()),
  status: v.union(taskStatusValidator, v.null()),
  assignee: v.union(userValidator, v.null()),
  projectKey: v.optional(v.string()),
  hasBlockers: v.boolean(),
});

/** Compute cycle status from start/due dates relative to today. */
function computeStatus(
  startDate: string | undefined,
  dueDate: string | undefined,
): CycleStatus {
  if (!startDate && !dueDate) return "draft";
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate && dueDate < today) return "completed";
  if (startDate && startDate > today) return "upcoming";
  return "active";
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.id("cycles"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const status = computeStatus(args.startDate, args.dueDate);

    const cycleId = await ctx.db.insert("cycles", {
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      name: args.name,
      description: args.description,
      startDate: args.startDate,
      dueDate: args.dueDate,
      status,
      creatorId: userId,
    });

    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: cycleId,
      action: "created", newValue: args.name, resourceName: args.name, scope: args.workspaceId,
    });

    return cycleId;
  },
});

export const update = mutation({
  args: {
    cycleId: v.id("cycles"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    startDate: v.optional(v.union(v.string(), v.null())),
    dueDate: v.optional(v.union(v.string(), v.null())),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("upcoming"),
        v.literal("active"),
        v.literal("completed"),
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, { cycleId, name, description, startDate, dueDate, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) throw new ConvexError("Cycle not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (description === null) patch.description = undefined;
    else if (description !== undefined) patch.description = description;

    // Resolve new effective dates (null means clear)
    const newStartDate = startDate === null ? undefined : (startDate ?? cycle.startDate);
    const newDueDate = dueDate === null ? undefined : (dueDate ?? cycle.dueDate);

    const datesChanged = startDate !== undefined || dueDate !== undefined;

    if (startDate === null) patch.startDate = undefined;
    else if (startDate !== undefined) patch.startDate = startDate;

    if (dueDate === null) patch.dueDate = undefined;
    else if (dueDate !== undefined) patch.dueDate = dueDate;

    // Recompute status when dates change, unless caller explicitly sets status
    if (status !== undefined) {
      patch.status = status;
    } else if (datesChanged) {
      patch.status = computeStatus(newStartDate, newDueDate);
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(cycleId, patch);
    }

    return null;
  },
});

export const remove = mutation({
  args: { cycleId: v.id("cycles") },
  returns: v.null(),
  handler: async (ctx, { cycleId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) throw new ConvexError("Cycle not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Delete all cycleTasks for this cycle
    const cycleTasks = await ctx.db
      .query("cycleTasks")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
      .collect();
    await Promise.all(cycleTasks.map((ct) => ctx.db.delete(ct._id)));

    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: cycleId,
      action: "deleted", oldValue: cycle.name, resourceName: cycle.name, scope: cycle.workspaceId,
    });

    await ctx.db.delete(cycleId);
    return null;
  },
});

export const get = query({
  args: { cycleId: v.id("cycles") },
  returns: v.union(cycleWithProgressValidator, v.null()),
  handler: async (ctx, { cycleId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) return null;

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return null;

    const cts = await ctx.db
      .query("cycleTasks")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
      .collect();
    const total = cts.length;
    const tasks = await Promise.all(cts.map((ct) => ctx.db.get(ct.taskId)));
    const completed = tasks.filter((t) => t?.completed).length;
    const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);

    return { ...cycle, totalTasks: total, completedTasks: completed, progressPercent };
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(cycleWithProgressValidator),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const project = await ctx.db.get(projectId);
    if (!project) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return [];

    const cycles = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return await Promise.all(
      cycles.map(async (cycle) => {
        const cts = await ctx.db
          .query("cycleTasks")
          .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
          .collect();
        const total = cts.length;
        const tasks = await Promise.all(cts.map((ct) => ctx.db.get(ct.taskId)));
        const completed = tasks.filter((t) => t?.completed).length;
        const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);
        return { ...cycle, totalTasks: total, completedTasks: completed, progressPercent };
      })
    );
  },
});

export const addTask = mutation({
  args: {
    cycleId: v.id("cycles"),
    taskId: v.id("tasks"),
  },
  returns: v.null(),
  handler: async (ctx, { cycleId, taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) throw new ConvexError("Cycle not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Idempotent: skip if already in cycle
    const existing = await ctx.db
      .query("cycleTasks")
      .withIndex("by_cycle_task", (q) => q.eq("cycleId", cycleId).eq("taskId", taskId))
      .first();
    if (existing) return null;

    await ctx.db.insert("cycleTasks", {
      cycleId,
      taskId,
      projectId: cycle.projectId,
      addedBy: userId,
    });

    return null;
  },
});

export const removeTask = mutation({
  args: {
    cycleId: v.id("cycles"),
    taskId: v.id("tasks"),
  },
  returns: v.null(),
  handler: async (ctx, { cycleId, taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) throw new ConvexError("Cycle not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const ct = await ctx.db
      .query("cycleTasks")
      .withIndex("by_cycle_task", (q) => q.eq("cycleId", cycleId).eq("taskId", taskId))
      .first();
    if (ct) {
      await ctx.db.delete(ct._id);
    }

    return null;
  },
});

/**
 * Returns { taskId, cycleDueDate } pairs for all tasks in cycles that have a
 * due date, scoped to a project. Used by the calendar for soft deadline inheritance:
 * tasks with no own dueDate inherit their cycle's dueDate for conflict detection.
 */
export const listTaskCycleDueDates = query({
  args: { projectId: v.id("projects") },
  returns: v.array(v.object({ taskId: v.id("tasks"), cycleDueDate: v.string() })),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const project = await ctx.db.get(projectId);
    if (!project) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return [];

    const cycles = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const pairs: { taskId: Id<"tasks">; cycleDueDate: string }[] = [];
    for (const cycle of cycles) {
      if (!cycle.dueDate) continue;
      const cts = await ctx.db
        .query("cycleTasks")
        .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
        .collect();
      for (const ct of cts) {
        pairs.push({ taskId: ct.taskId, cycleDueDate: cycle.dueDate });
      }
    }

    return pairs;
  },
});

/**
 * Combined query for the calendar view: returns cycles with progress AND
 * task→cycleDueDate pairs in a single round-trip, avoiding two separate
 * subscriptions that both fetch the same cycles/cycleTasks data.
 */
export const listForCalendar = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    cycles: v.array(cycleWithProgressValidator),
    taskCycleDueDatePairs: v.array(
      v.object({ taskId: v.id("tasks"), cycleDueDate: v.string() })
    ),
  }),
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { cycles: [], taskCycleDueDatePairs: [] };

    const project = await ctx.db.get(projectId);
    if (!project) return { cycles: [], taskCycleDueDatePairs: [] };

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return { cycles: [], taskCycleDueDatePairs: [] };

    const rawCycles = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const taskCycleDueDatePairs: { taskId: Id<"tasks">; cycleDueDate: string }[] = [];

    const cycles = await Promise.all(
      rawCycles.map(async (cycle) => {
        const cts = await ctx.db
          .query("cycleTasks")
          .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
          .collect();
        const total = cts.length;
        const tasks = await Promise.all(cts.map((ct) => ctx.db.get(ct.taskId)));
        const completed = tasks.filter((t) => t?.completed).length;
        const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);

        if (cycle.dueDate) {
          for (const ct of cts) {
            taskCycleDueDatePairs.push({ taskId: ct.taskId, cycleDueDate: cycle.dueDate });
          }
        }

        return { ...cycle, totalTasks: total, completedTasks: completed, progressPercent };
      })
    );

    return { cycles, taskCycleDueDatePairs };
  },
});

export const listCycleTasks = query({
  args: {
    cycleId: v.id("cycles"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(enrichedTaskValidator),
  handler: async (ctx, { cycleId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const cycle = await ctx.db.get(cycleId);
    if (!cycle) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", cycle.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return [];

    const project = await ctx.db.get(cycle.projectId);

    const cts = await ctx.db
      .query("cycleTasks")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycleId))
      .collect();

    const tasks = (
      await Promise.all(cts.map((ct) => ctx.db.get(ct.taskId)))
    ).filter((t): t is NonNullable<typeof t> => t !== null);

    const shouldHideCompleted = hideCompleted ?? false;
    const filtered = shouldHideCompleted ? tasks.filter((t) => !t.completed) : tasks;

    // Enrich identically to tasks.listByProject (status, assignee, projectKey, hasBlockers)
    const enriched = await Promise.all(
      filtered.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
        const blockerEdges = await ctx.db
          .query("edges")
          .withIndex("by_target", (q) => q.eq("targetId", task._id))
          .collect();
        return {
          ...task,
          status,
          assignee,
          projectKey: project?.key,
          hasBlockers: blockerEdges.some((e) => e.edgeType === "blocks"),
        };
      })
    );

    // Sort by position (fractional-indexing ordinal order)
    enriched.sort((a, b) => {
      const posA = a.position ?? "";
      const posB = b.position ?? "";
      if (posA < posB) return -1;
      if (posA > posB) return 1;
      return a._creationTime - b._creationTime;
    });

    return enriched;
  },
});
