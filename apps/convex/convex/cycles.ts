import { ConvexError, v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { logActivity } from "./auditLog";
import { cycleStatusValidator, taskStatusValidator, userValidator } from "./validators";
import { baseTaskFields, enrichTasks, taskSuggestionValidator } from "./tasks";
import { requireWorkspaceMember, requireResourceMember, checkResourceMember } from "./authHelpers";
import { getAll } from "convex-helpers/server/relationships";
import { tasksByCycle, cycleNamespace } from "./dbTriggers";
import {
  assertOpenCycleInProject,
  cycleStatusOf,
  moveTaskToCycle,
  nextCycleName,
} from "./lib/cycleRules";

/**
 * Cycles are milestones a project's tasks are planned into. A task is in at
 * most one cycle (`tasks.cycleId`); no cycle is the backlog. A cycle is opened
 * and closed by hand — its dates are informational. One open cycle is the
 * project's *current* one (`projects.currentCycleId`), which is where the
 * Tasks tab opens.
 */

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
  closedAt: v.optional(v.number()),
  closedBy: v.optional(v.id("users")),
  creatorId: v.id("users"),
  isCurrent: v.boolean(),
  totalTasks: v.number(),
  completedTasks: v.number(),
  progressPercent: v.number(),
});

const enrichedTaskValidator = v.object({
  ...baseTaskFields,
  status: v.union(taskStatusValidator, v.null()),
  assignee: v.union(userValidator, v.null()),
  projectKey: v.optional(v.string()),
  hasBlockers: v.boolean(),
});

/**
 * A cycle as the client sees it: status read through the two-state model,
 * progress from the `tasksByCycle` aggregate. The aggregate is two O(log n)
 * reads; counting the cycle's tasks directly would put every one of them in
 * the read set of these subscriptions, re-running them on any edit to any task
 * in the cycle.
 */
async function withProgress(
  ctx: QueryCtx,
  cycle: Doc<"cycles">,
  currentCycleId: Id<"cycles"> | undefined,
) {
  const namespace = cycleNamespace(cycle.projectId, cycle._id);
  const [totalTasks, completedTasks] = await Promise.all([
    tasksByCycle.count(ctx, { namespace, bounds: {} }),
    tasksByCycle.sum(ctx, { namespace, bounds: {} }),
  ]);
  return {
    _id: cycle._id,
    _creationTime: cycle._creationTime,
    projectId: cycle.projectId,
    workspaceId: cycle.workspaceId,
    name: cycle.name,
    description: cycle.description,
    startDate: cycle.startDate,
    dueDate: cycle.dueDate,
    status: cycleStatusOf(cycle),
    closedAt: cycle.closedAt,
    closedBy: cycle.closedBy,
    creatorId: cycle.creatorId,
    isCurrent: cycle._id === currentCycleId,
    totalTasks,
    completedTasks,
    progressPercent:
      totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
  };
}

/** Insert an open cycle. The caller has authorized the project. */
export async function insertCycle(
  ctx: MutationCtx,
  args: {
    project: Doc<"projects">;
    userId: Id<"users">;
    name?: string;
    description?: string;
    startDate?: string;
    dueDate?: string;
  },
): Promise<Id<"cycles">> {
  const name = args.name?.trim() || (await nextCycleName(ctx, args.project._id));
  const cycleId = await ctx.db.insert("cycles", {
    projectId: args.project._id,
    workspaceId: args.project.workspaceId,
    name,
    description: args.description,
    startDate: args.startDate,
    dueDate: args.dueDate,
    status: "open",
    creatorId: args.userId,
  });
  await logActivity(ctx, {
    userId: args.userId, resourceType: "cycles", resourceId: cycleId,
    action: "created", newValue: name, resourceName: name, scope: args.project.workspaceId,
  });
  return cycleId;
}

/**
 * The open cycle that takes over when `excluding` stops being current: the
 * oldest one still open, or none.
 */
async function successorCycle(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  excluding: Id<"cycles">,
): Promise<Id<"cycles"> | undefined> {
  const cycles = await ctx.db
    .query("cycles")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return cycles.find((c) => c._id !== excluding && cycleStatusOf(c) === "open")?._id;
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    // Omitted → "Cycle N".
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.id("cycles"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);

    // `args.projectId` is a second caller-supplied id the workspace gate never
    // sees — mirror of the tasks.create guard.
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project not found");
    if (project.workspaceId !== args.workspaceId) {
      throw new ConvexError("Project does not belong to this workspace");
    }

    const cycleId = await insertCycle(ctx, {
      project,
      userId,
      name: args.name,
      description: args.description,
      startDate: args.startDate,
      dueDate: args.dueDate,
    });

    // A project whose cycles were all closed has no current one; the first
    // cycle opened after that becomes it.
    if (!project.currentCycleId) {
      await ctx.db.patch(project._id, { currentCycleId: cycleId });
    }

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
  },
  returns: v.null(),
  handler: async (ctx, { cycleId, name, description, startDate, dueDate }) => {
    const { userId, resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);

    const patch: Partial<Doc<"cycles">> = {};
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

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(cycleId, patch);
    }

    // Log activity: rename and date changes get their own entries so the
    // timeline shows what actually changed. Description-only edits stay
    // silent (same convention as projects/workspaces).
    const finalName = name ?? cycle.name;
    if (name !== undefined && name !== cycle.name) {
      await logActivity(ctx, {
        userId, resourceType: "cycles", resourceId: cycleId,
        action: "renamed", oldValue: cycle.name, newValue: name,
        resourceName: finalName, scope: cycle.workspaceId,
      });
    }
    if (datesChanged) {
      const fmt = (s: string | undefined) =>
        s ? s : "";
      const oldRange = `${fmt(cycle.startDate)}${cycle.startDate || cycle.dueDate ? " – " : ""}${fmt(cycle.dueDate)}`.trim();
      const newRange = `${fmt(newStartDate)}${newStartDate || newDueDate ? " – " : ""}${fmt(newDueDate)}`.trim();
      if (oldRange !== newRange) {
        await logActivity(ctx, {
          userId, resourceType: "cycles", resourceId: cycleId,
          action: "dates_changed",
          oldValue: oldRange || undefined,
          newValue: newRange || undefined,
          resourceName: finalName, scope: cycle.workspaceId,
        });
      }
    }

    return null;
  },
});

/**
 * Upper bound on the unfinished tasks one `close` moves. Every move fans out
 * through the task triggers (tag joins, both task aggregates), so this keeps
 * the transaction well inside its write limit. A cycle with more unfinished
 * work than this has stopped being a milestone; move some out first.
 */
const CLOSE_MAX_UNFINISHED = 500;

const unfinishedDestinationValidator = v.union(
  v.object({ kind: v.literal("backlog") }),
  v.object({ kind: v.literal("cycle"), cycleId: v.id("cycles") }),
  v.object({ kind: v.literal("newCycle"), name: v.optional(v.string()) }),
);

/**
 * Close a cycle. Completed tasks stay in it as its record; unfinished ones go
 * where the caller says. If it was the project's current cycle, the
 * destination cycle takes over — or, when the work went to the backlog, the
 * oldest other open cycle (none if there isn't one).
 */
export const close = mutation({
  args: {
    cycleId: v.id("cycles"),
    unfinishedTo: unfinishedDestinationValidator,
  },
  returns: v.object({
    moved: v.number(),
    destinationCycleId: v.union(v.id("cycles"), v.null()),
  }),
  handler: async (ctx, { cycleId, unfinishedTo }) => {
    const { userId, resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);
    if (cycleStatusOf(cycle) === "closed") {
      throw new ConvexError("Cycle is already closed");
    }
    const project = await ctx.db.get(cycle.projectId);
    if (!project) throw new ConvexError("Project not found");

    const unfinished = await ctx.db
      .query("tasks")
      .withIndex("by_project_cycle_completed", (q) =>
        q.eq("projectId", cycle.projectId).eq("cycleId", cycleId).eq("completed", false),
      )
      .take(CLOSE_MAX_UNFINISHED + 1);
    if (unfinished.length > CLOSE_MAX_UNFINISHED) {
      throw new ConvexError(
        `This cycle has more than ${CLOSE_MAX_UNFINISHED} unfinished tasks — move some out before closing it`,
      );
    }

    let destination: Doc<"cycles"> | null = null;
    if (unfinishedTo.kind === "cycle") {
      if (unfinishedTo.cycleId === cycleId) {
        throw new ConvexError("Pick a different cycle for the unfinished tasks");
      }
      destination = await assertOpenCycleInProject(ctx, unfinishedTo.cycleId, cycle.projectId);
    } else if (unfinishedTo.kind === "newCycle") {
      const newId = await insertCycle(ctx, { project, userId, name: unfinishedTo.name });
      destination = await ctx.db.get(newId);
    }

    // Close first: `assertOpenCycleInProject` above already refused the cycle
    // being closed as a destination, and closing before moving means no
    // concurrent reader sees the moved tasks back in an open source cycle.
    await ctx.db.patch(cycleId, { status: "closed", closedAt: Date.now(), closedBy: userId });

    for (const task of unfinished) {
      await ctx.db.patch(task._id, { cycleId: destination?._id });
    }

    if (project.currentCycleId === cycleId || !project.currentCycleId) {
      const next = destination?._id ?? (await successorCycle(ctx, project._id, cycleId));
      await ctx.db.patch(project._id, { currentCycleId: next });
    }

    // One entry for the whole close rather than one per moved task: a close is
    // a single decision, and per-task entries would bury it. The moved ids
    // ride along in `taskIds`, so the carry-over is still traceable per task.
    const movedIds = unfinished.map((task) => task._id);
    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: cycleId,
      action: "closed",
      newValue: unfinished.length === 0
        ? undefined
        : `${unfinished.length} unfinished → ${destination?.name ?? "Backlog"}`,
      resourceName: cycle.name, scope: cycle.workspaceId,
      taskIds: movedIds,
    });
    // The receiving cycle's own record of the same move — without it, that
    // cycle's history could only be rebuilt by scanning every other cycle's
    // close entries for its id.
    if (destination && unfinished.length > 0) {
      await logActivity(ctx, {
        userId, resourceType: "cycles", resourceId: destination._id,
        action: "carried_in",
        newValue: `${unfinished.length} from ${cycle.name}`,
        resourceName: destination.name, scope: destination.workspaceId,
        taskIds: movedIds,
      });
    }

    return { moved: unfinished.length, destinationCycleId: destination?._id ?? null };
  },
});

export const reopen = mutation({
  args: { cycleId: v.id("cycles") },
  returns: v.null(),
  handler: async (ctx, { cycleId }) => {
    const { userId, resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);
    if (cycleStatusOf(cycle) === "open") return null;

    await ctx.db.patch(cycleId, { status: "open", closedAt: undefined, closedBy: undefined });

    const project = await ctx.db.get(cycle.projectId);
    if (project && !project.currentCycleId) {
      await ctx.db.patch(project._id, { currentCycleId: cycleId });
    }

    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: cycleId,
      action: "reopened", resourceName: cycle.name, scope: cycle.workspaceId,
    });
    return null;
  },
});

/** Make an open cycle the one the project's Tasks tab opens on. */
export const setCurrent = mutation({
  args: { cycleId: v.id("cycles") },
  returns: v.null(),
  handler: async (ctx, { cycleId }) => {
    const { resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);
    if (cycleStatusOf(cycle) === "closed") {
      throw new ConvexError("Only an open cycle can be the current one");
    }
    await ctx.db.patch(cycle.projectId, { currentCycleId: cycleId });
    return null;
  },
});

/**
 * Upper bound on the tasks a cycle delete sends back to the backlog in one
 * transaction — same reasoning as `CLOSE_MAX_UNFINISHED`.
 */
const REMOVE_MAX_TASKS = 500;

/**
 * Delete a cycle. Its tasks — finished or not — go back to the backlog; a
 * cycle is a plan, and deleting the plan must not delete the work.
 *
 * A project's last cycle cannot be deleted: every project has at least one
 * cycle (it is created with "Cycle 1"), which is also what lets
 * `migrateCyclesToBacklogModel` tell a migrated project from one that never
 * had cycles.
 */
export const remove = mutation({
  args: { cycleId: v.id("cycles") },
  returns: v.null(),
  handler: async (ctx, { cycleId }) => {
    const { userId, resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);

    const siblings = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", cycle.projectId))
      .take(2);
    if (siblings.length < 2) {
      throw new ConvexError("A project needs at least one cycle. Close this one instead of deleting it.");
    }

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_cycle_completed", (q) =>
        q.eq("projectId", cycle.projectId).eq("cycleId", cycleId),
      )
      .take(REMOVE_MAX_TASKS + 1);
    if (tasks.length > REMOVE_MAX_TASKS) {
      throw new ConvexError(
        `This cycle has more than ${REMOVE_MAX_TASKS} tasks — move some out before deleting it`,
      );
    }
    for (const task of tasks) {
      await ctx.db.patch(task._id, { cycleId: undefined });
    }

    const project = await ctx.db.get(cycle.projectId);
    if (project?.currentCycleId === cycleId) {
      await ctx.db.patch(project._id, {
        currentCycleId: await successorCycle(ctx, project._id, cycleId),
      });
    }

    await logActivity(ctx, {
      userId, resourceType: "cycles", resourceId: cycleId,
      action: "deleted", oldValue: cycle.name, resourceName: cycle.name, scope: cycle.workspaceId,
      // Everything it held went back to the backlog.
      taskIds: tasks.map((task) => task._id),
    });

    await ctx.db.delete(cycleId);
    return null;
  },
});

export const get = query({
  args: { cycleId: v.id("cycles") },
  returns: v.union(cycleWithProgressValidator, v.null()),
  handler: async (ctx, { cycleId }) => {
    const result = await checkResourceMember(ctx, "cycles", cycleId);
    if (!result) return null;
    const cycle = result.resource;
    const project = await ctx.db.get(cycle.projectId);
    return await withProgress(ctx, cycle, project?.currentCycleId);
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(cycleWithProgressValidator),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return [];

    const cycles = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return await Promise.all(
      cycles.map((cycle) => withProgress(ctx, cycle, result.resource.currentCycleId)),
    );
  },
});

/**
 * How many tasks sit in the project's backlog and how many of those are open.
 * Read from the backlog's `tasksByCycle` namespace, so the overview's backlog
 * figure doesn't subscribe to every backlog task.
 */
export const backlogSize = query({
  args: { projectId: v.id("projects") },
  returns: v.union(v.object({ total: v.number(), open: v.number() }), v.null()),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return null;
    const namespace = cycleNamespace(projectId, undefined);
    const [total, completed] = await Promise.all([
      tasksByCycle.count(ctx, { namespace, bounds: {} }),
      tasksByCycle.sum(ctx, { namespace, bounds: {} }),
    ]);
    return { total, open: total - completed };
  },
});

/** Upper bound on one `moveTasks` / `addTasks` call — the pickers offer at most 50. */
const MOVE_TASKS_MAX_BATCH = 100;

/**
 * Move a selection of tasks into a cycle (`cycleId`) or back to the backlog
 * (`null`), in one transaction. Larger selections go through `taskBulk`'s
 * `moveToCycle` op, which batches. Returns how many tasks actually moved
 * (tasks already there are skipped, not errors).
 */
export const moveTasks = mutation({
  args: {
    projectId: v.id("projects"),
    taskIds: v.array(v.id("tasks")),
    cycleId: v.union(v.id("cycles"), v.null()),
  },
  returns: v.number(),
  handler: async (ctx, { projectId, taskIds, cycleId }) => {
    if (taskIds.length > MOVE_TASKS_MAX_BATCH) {
      throw new ConvexError(`At most ${MOVE_TASKS_MAX_BATCH} tasks can be moved at once`);
    }
    const { userId } = await requireResourceMember(ctx, "projects", projectId);
    const target = cycleId ? await assertOpenCycleInProject(ctx, cycleId, projectId) : null;

    let moved = 0;
    for (const taskId of new Set(taskIds)) {
      const task = await ctx.db.get(taskId);
      if (!task) throw new ConvexError("Task not found");
      // The caller authorized the PROJECT; each task id is unrelated to it.
      if (task.projectId !== projectId) {
        throw new ConvexError("Task does not belong to this project");
      }
      if (await moveTaskToCycle(ctx, { task, target, userId })) moved++;
    }
    return moved;
  },
});

/**
 * Pull tasks into a cycle — the cycle page's "Add tasks" picker. Same as
 * `moveTasks` with the cycle as the gate: a task in another open cycle moves
 * here, since a task is in one cycle at a time.
 */
export const addTasks = mutation({
  args: {
    cycleId: v.id("cycles"),
    taskIds: v.array(v.id("tasks")),
  },
  returns: v.number(),
  handler: async (ctx, { cycleId, taskIds }) => {
    if (taskIds.length > MOVE_TASKS_MAX_BATCH) {
      throw new ConvexError(`At most ${MOVE_TASKS_MAX_BATCH} tasks can be added at once`);
    }
    const { userId, resource: cycle } = await requireResourceMember(ctx, "cycles", cycleId);
    const target = await assertOpenCycleInProject(ctx, cycleId, cycle.projectId);

    let added = 0;
    for (const taskId of new Set(taskIds)) {
      const task = await ctx.db.get(taskId);
      if (!task) throw new ConvexError("Task not found");
      // The caller authorized the CYCLE; `taskId` is unrelated to it. Without
      // this a foreign task is filed into a local cycle and `listCycleTasks`
      // then returns it enriched — including the assignee's email.
      if (await moveTaskToCycle(ctx, { task, target, userId })) added++;
    }
    return added;
  },
});

/** Send one task from a cycle back to the backlog. No-op if it isn't in that cycle. */
export const removeTask = mutation({
  args: {
    cycleId: v.id("cycles"),
    taskId: v.id("tasks"),
  },
  returns: v.null(),
  handler: async (ctx, { cycleId, taskId }) => {
    const { userId } = await requireResourceMember(ctx, "cycles", cycleId);
    const task = await ctx.db.get(taskId);
    if (task && task.cycleId === cycleId) {
      await moveTaskToCycle(ctx, { task, target: null, userId });
    }
    return null;
  },
});

/** Rows the add-to-cycle picker shows when the caller doesn't say. */
const SUGGEST_ADDABLE_DEFAULT_LIMIT = 25;

/**
 * Candidate feed for the add-to-cycle picker.
 *
 * Two modes, and the product stance lives in the difference:
 * - **Browse** (no query): the project's newest unfinished *backlog* tasks.
 *   Planning a cycle is pulling from the backlog; tasks already planned into
 *   another cycle are not offered unasked.
 * - **Search** (query): the `nodes.by_name` search index across the whole
 *   project — other cycles and completed tasks included. Naming a task is the
 *   signal ("move that one here", "I finished it last week, it counts here").
 *
 * Tasks already in this cycle are dropped server-side. The search branch
 * post-filters a workspace-wide index on `projectId` (the index has no project
 * filter field), so it over-fetches and can under-fill when other projects
 * dominate the matches — acceptable for a picker that ranks by relevance.
 */
export const suggestAddableTasks = query({
  args: {
    cycleId: v.id("cycles"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(taskSuggestionValidator),
  handler: async (ctx, { cycleId, query: searchText, limit }) => {
    const result = await checkResourceMember(ctx, "cycles", cycleId);
    if (!result) return [];
    const cycle = result.resource;

    const take = Math.max(1, Math.min(limit ?? SUGGEST_ADDABLE_DEFAULT_LIMIT, 50));
    const trimmed = (searchText ?? "").trim();

    let tasks: Doc<"tasks">[];
    if (trimmed.length > 0) {
      const candidates = await ctx.db
        .query("nodes")
        .withSearchIndex("by_name", (q) =>
          q
            .search("name", trimmed)
            .eq("workspaceId", cycle.workspaceId)
            .eq("resourceType", "task")
            .eq("searchable", true),
        )
        .take(Math.min(take * 4, 200));
      const fetched = await getAll(
        ctx.db,
        candidates.map((n) => n.resourceId as Id<"tasks">),
      );
      tasks = fetched
        .filter(
          (t): t is Doc<"tasks"> =>
            t !== null && t.projectId === cycle.projectId && t.cycleId !== cycleId,
        )
        .slice(0, take);
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_cycle_completed", (q) =>
          q.eq("projectId", cycle.projectId).eq("cycleId", undefined).eq("completed", false),
        )
        .order("desc")
        .take(take);
    }

    const project = await ctx.db.get(cycle.projectId);
    const statusIds = [...new Set(tasks.map((t) => t.statusId))];
    const statuses = await getAll(ctx.db, statusIds);
    const statusMap = new Map(statusIds.map((id, i) => [id, statuses[i]]));

    return tasks.map((t) => ({
      _id: t._id,
      title: t.title,
      completed: t.completed,
      statusColor: statusMap.get(t.statusId)?.color,
      projectKey: project?.key,
      number: t.number,
    }));
  },
});

/**
 * The calendar's cycles. Task → cycle due-date fallback is resolved on the
 * client from `task.cycleId`, which every task row now carries.
 */
export const listForCalendar = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    cycles: v.array(cycleWithProgressValidator),
  }),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return { cycles: [] };

    const rawCycles = await ctx.db
      .query("cycles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const cycles = await Promise.all(
      rawCycles.map((cycle) => withProgress(ctx, cycle, result.resource.currentCycleId)),
    );
    return { cycles };
  },
});

export const listCycleTasks = query({
  args: {
    cycleId: v.id("cycles"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(enrichedTaskValidator),
  handler: async (ctx, { cycleId, hideCompleted }) => {
    const result = await checkResourceMember(ctx, "cycles", cycleId);
    if (!result) return [];
    const cycle = result.resource;

    const project = await ctx.db.get(cycle.projectId);

    // `projectId` comes from the authorized cycle, so the index cannot reach a
    // task outside it.
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_cycle_completed", (q) => {
        const scoped = q.eq("projectId", cycle.projectId).eq("cycleId", cycleId);
        return hideCompleted ? scoped.eq("completed", false) : scoped;
      })
      .collect();

    // Enrich through the same helper tasks.listByProject uses, rather than a
    // copy of it: `enrichTasks` dedupes the status and assignee point-reads
    // across the page — a cycle's tasks nearly all share a handful of statuses.
    const enriched = await enrichTasks(ctx, tasks, project?.key);

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
