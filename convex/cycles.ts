import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const cycleStatusValidator = v.union(
  v.literal("draft"),
  v.literal("upcoming"),
  v.literal("active"),
  v.literal("completed"),
);

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

const priorityValidator = v.union(
  v.literal("urgent"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

const taskStatusValidator = v.object({
  _id: v.id("taskStatuses"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  name: v.string(),
  color: v.string(),
  order: v.number(),
  isDefault: v.boolean(),
  isCompleted: v.boolean(),
  setsStartDate: v.optional(v.boolean()),
});

const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  image: v.optional(v.string()),
  isAnonymous: v.optional(v.boolean()),
});

const enrichedTaskValidator = v.object({
  _id: v.id("tasks"),
  _creationTime: v.number(),
  projectId: v.id("projects"),
  workspaceId: v.id("workspaces"),
  title: v.string(),
  statusId: v.id("taskStatuses"),
  assigneeId: v.optional(v.id("users")),
  priority: priorityValidator,
  labels: v.optional(v.array(v.string())),
  completed: v.boolean(),
  creatorId: v.id("users"),
  position: v.optional(v.string()),
  yjsSnapshotId: v.optional(v.id("_storage")),
  number: v.optional(v.number()),
  dueDate: v.optional(v.string()),
  startDate: v.optional(v.string()),
  estimate: v.optional(v.number()),
  status: v.union(taskStatusValidator, v.null()),
  assignee: v.union(userValidator, v.null()),
  projectKey: v.optional(v.string()),
  hasBlockers: v.boolean(),
});

/** Compute cycle status from start/due dates relative to today. */
function computeStatus(
  startDate: string | undefined,
  dueDate: string | undefined,
): "draft" | "upcoming" | "active" | "completed" {
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

    return await ctx.db.insert("cycles", {
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      name: args.name,
      description: args.description,
      startDate: args.startDate,
      dueDate: args.dueDate,
      status,
      creatorId: userId,
    });
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
        const blocker = await ctx.db
          .query("taskDependencies")
          .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", task._id))
          .first();
        return {
          ...task,
          status,
          assignee,
          projectKey: project?.key,
          hasBlockers: blocker?.type === "blocks",
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
