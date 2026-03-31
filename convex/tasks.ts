import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

import { generateKeyBetween } from "fractional-indexing";
import { getUserDisplayName } from "@shared/displayName";
import { auditLog, logTaskActivity } from "./auditLog";
import { triggers } from "./dbTriggers";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { cascadeDelete, logCascadeSummary } from "./cascadeDelete";

import { priorityValidator, taskStatusValidator, userValidator, projectValidator } from "./validators";
import { requireWorkspaceMember, requireResourceMember, checkWorkspaceMember, checkResourceMember } from "./authHelpers";
import { scheduleNotification } from "./notificationPool";

export const baseTaskFields = {
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
  plannedStartDate: v.optional(v.string()),
  workPeriods: v.optional(v.array(v.object({
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }))),
  estimate: v.optional(v.number()),
};

export const enrichedTaskValidator = v.object({
  ...baseTaskFields,
  status: v.union(taskStatusValidator, v.null()),
  assignee: v.union(userValidator, v.null()),
  projectKey: v.optional(v.string()),
  hasBlockers: v.boolean(),
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    title: v.string(),
    statusId: v.optional(v.id("taskStatuses")),
    assigneeId: v.optional(v.id("users")),
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low")
      )
    ),
    labels: v.optional(v.array(v.string())),
    position: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    plannedStartDate: v.optional(v.string()),
    estimate: v.optional(v.number()),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId);

    // Get project to access workspaceId
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project not found");

    // If no statusId provided, fetch the default status for the project
    let statusId = args.statusId;
    if (!statusId) {
      const defaultStatus = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project_isDefault", (q) =>
          q.eq("projectId", args.projectId).eq("isDefault", true)
        )
        .first();

      if (!defaultStatus) {
        throw new ConvexError("No default status found for project. Ensure statuses are seeded.");
      }
      statusId = defaultStatus._id;
    }

    // Get status to check if it marks task as completed
    const status = await ctx.db.get(statusId);
    if (!status) throw new ConvexError("Status not found");

    // Calculate position if not provided
    let position = args.position;
    if (!position) {
      // Find the last task in this project+status by position
      const tasksInStatus = await ctx.db
        .query("tasks")
        .withIndex("by_project_status_position", (q) =>
          q.eq("projectId", args.projectId).eq("statusId", statusId)
        )
        .collect();

      const lastTask = tasksInStatus.length > 0
        ? tasksInStatus.reduce((max, task) =>
            (task.position ?? '') > (max.position ?? '') ? task : max
          )
        : null;

      position = generateKeyBetween(lastTask?.position ?? null, null);
    }

    // Assign sequential task number — serialization point under OCC.
    // Concurrent creates on the same project will retry automatically.
    const counter = project.taskCounter ?? 0;
    const nextNumber = counter + 1;
    await ctx.db.patch(args.projectId, { taskCounter: nextNumber });

    // Create task with all fields
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const taskId = await db.insert("tasks", {
      projectId: args.projectId,
      workspaceId: project.workspaceId,
      title: args.title,
      statusId,
      assigneeId: args.assigneeId,
      priority: args.priority ?? "medium",
      labels: args.labels,
      completed: status.isCompleted,
      creatorId: userId,
      position,
      number: nextNumber,
      dueDate: args.dueDate,
      plannedStartDate: args.plannedStartDate,
      estimate: args.estimate,
    });

    // Log task creation activity
    await logTaskActivity(ctx, { taskId, userId, workspaceId: project.workspaceId, type: "created", taskTitle: args.title });

    // Schedule notifications after database write
    const user = await ctx.db.get(userId);

    // Assignment notification
    if (args.assigneeId && args.assigneeId !== userId) {
      await ctx.scheduler.runAfter(
        0,
        internal.taskNotifications.notifyTaskAssignment,
        {
          taskId,
          assigneeId: args.assigneeId,
          taskTitle: args.title,
          assignedBy: {
            name: getUserDisplayName(user),
            id: userId,
          },
        },
      );
    }

    return taskId;
  },
});

export const get = query({
  args: { taskId: v.id("tasks") },
  returns: v.union(enrichedTaskValidator, v.null()),
  handler: async (ctx, { taskId }) => {
    const result = await checkResourceMember(ctx, "tasks", taskId);
    if (!result) return null;
    const task = result.resource;

    // Enrich with status, assignee, project key, and blocker status
    const status = await ctx.db.get(task.statusId);
    const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
    const project = await ctx.db.get(task.projectId);

    // Check if this task has any blockers (incoming "blocks" edges)
    const blockerEdges = await ctx.db
      .query("edges")
      .withIndex("by_target", (q) => q.eq("targetId", taskId))
      .collect();
    const hasBlockers = blockerEdges.some((e) => e.edgeType === "blocks");

    return {
      ...task,
      status,
      assignee,
      projectKey: project?.key,
      hasBlockers,
    };
  },
});

export const getInternal = internalQuery({
  args: { taskId: v.id("tasks") },
  returns: v.union(
    v.object({
      _id: v.id("tasks"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      workspaceId: v.id("workspaces"),
    }),
    v.null(),
  ),
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    return {
      _id: task._id,
      _creationTime: task._creationTime,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
    };
  },
});

export const hasAnyTasks = query({
  args: { projectId: v.id("projects") },
  returns: v.boolean(),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return false;

    const task = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();

    return task !== null;
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(enrichedTaskValidator),
  handler: async (ctx, { projectId, hideCompleted }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return [];
    const project = result.resource;

    // If hideCompleted: query by_project_completed with completed=false
    const shouldHideCompleted = hideCompleted ?? true;
    let tasks;

    if (shouldHideCompleted) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_completed", (q) =>
          q.eq("projectId", projectId).eq("completed", false)
        )
        .order("desc") // newest first
        .collect();
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc") // newest first
        .collect();
    }

    // Enrich each task with status, assignee, project key, and blocker status
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
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
          projectKey: project.key,
          hasBlockers: blockerEdges.some((e) => e.edgeType === "blocks"),
        };
      })
    );

    // Sort by position — use plain < / > (character-code order) because
    // fractional-indexing strings require ordinal comparison, not locale collation.
    enrichedTasks.sort((a, b) => {
      const posA = a.position ?? '';
      const posB = b.position ?? '';
      if (posA < posB) return -1;
      if (posA > posB) return 1;
      return a._creationTime - b._creationTime;
    });

    return enrichedTasks;
  },
});

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    ...baseTaskFields,
    status: v.union(v.object({
      name: v.string(),
      color: v.string(),
      isCompleted: v.boolean(),
    }), v.null()),
    projectKey: v.optional(v.string()),
  })),
  handler: async (ctx, { workspaceId, hideCompleted }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    // Use the existing by_workspace index
    let tasks = await ctx.db
      .query("tasks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    if (hideCompleted) {
      tasks = tasks.filter((t) => !t.completed);
    }

    // Cap at 200 for performance (used for autocomplete)
    tasks = tasks.slice(0, 200);

    // Batch project lookups via cache for efficiency
    const projectCache = new Map<string, any>();
    const getProject = async (projectId: any) => {
      const key = projectId.toString();
      if (!projectCache.has(key)) {
        projectCache.set(key, await ctx.db.get(projectId));
      }
      return projectCache.get(key);
    };

    // Enrich with status and project key info
    return Promise.all(
      tasks.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const proj = await getProject(task.projectId);
        return {
          ...task,
          status: status
            ? { name: status.name, color: status.color, isCompleted: status.isCompleted }
            : null,
          projectKey: proj?.key,
        };
      })
    );
  },
});

export const listByAssignee = query({
  args: {
    workspaceId: v.id("workspaces"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    ...baseTaskFields,
    status: v.union(taskStatusValidator, v.null()),
    assignee: v.union(userValidator, v.null()),
    project: v.union(projectValidator, v.null()),
    projectKey: v.optional(v.string()),
  })),
  handler: async (ctx, { workspaceId, hideCompleted }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Query tasks assigned to current user
    const shouldHideCompleted = hideCompleted ?? true;
    let tasks;

    if (shouldHideCompleted) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_assignee_completed", (q) =>
          q.eq("assigneeId", userId).eq("completed", false)
        )
        .collect();
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_assignee", (q) => q.eq("assigneeId", userId))
        .collect();
    }

    // Filter to only tasks in the specified workspace
    const workspaceTasks = tasks.filter((task) => task.workspaceId === workspaceId);

    // Enrich with status, assignee, and project data
    const enrichedTasks = await Promise.all(
      workspaceTasks.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
        const project = await ctx.db.get(task.projectId);

        return {
          ...task,
          status,
          assignee,
          project,
          projectKey: project?.key,
        };
      })
    );

    return enrichedTasks;
  },
});

export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    statusId: v.optional(v.id("taskStatuses")),
    assigneeId: v.optional(v.union(v.id("users"), v.null())),
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low")
      )
    ),
    labels: v.optional(v.array(v.string())),
    position: v.optional(v.string()),
    dueDate: v.optional(v.union(v.string(), v.null())),
    plannedStartDate: v.optional(v.union(v.string(), v.null())),
    estimate: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, title, statusId, assigneeId, priority, labels, position, dueDate, plannedStartDate, estimate }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    // Build patch object with only provided fields
    const patch: Record<string, any> = {};

    if (title !== undefined) patch.title = title;
    if (assigneeId === null) patch.assigneeId = undefined;
    else if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    if (priority !== undefined) patch.priority = priority;
    if (labels !== undefined) patch.labels = labels;
    if (position !== undefined) patch.position = position;
    if (dueDate === null) patch.dueDate = undefined;
    else if (dueDate !== undefined) patch.dueDate = dueDate;
    if (plannedStartDate === null) patch.plannedStartDate = undefined;
    else if (plannedStartDate !== undefined) patch.plannedStartDate = plannedStartDate;
    if (estimate === null) patch.estimate = undefined;
    else if (estimate !== undefined) patch.estimate = estimate;

    // If statusId changed: look up new status, sync completed field and work periods
    if (statusId !== undefined) {
      const newStatus = await ctx.db.get(statusId);
      if (!newStatus) throw new ConvexError("Status not found");

      patch.statusId = statusId;
      // Two-way sync: auto-complete when moving TO a completed status,
      // auto-uncomplete when moving to a non-completed status
      patch.completed = newStatus.isCompleted;

      const existingPeriods: { startedAt: number; completedAt?: number }[] = task.workPeriods ?? [];
      const openPeriod = existingPeriods.find((p) => p.completedAt === undefined);

      if (newStatus.setsStartDate && !openPeriod) {
        // Append a new open work period
        patch.workPeriods = [...existingPeriods, { startedAt: Date.now() }];
      } else if (newStatus.isCompleted && openPeriod) {
        // Close the open work period
        patch.workPeriods = existingPeriods.map((p) =>
          p.completedAt === undefined ? { ...p, completedAt: Date.now() } : p
        );
      }
    }

    if (Object.keys(patch).length > 0) {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.patch(taskId, patch);
    }

    // Log activity for each changed field
    if (title !== undefined && title !== task.title) {
      await logTaskActivity(ctx, { taskId, userId, workspaceId: task.workspaceId, type: "title_change", oldValue: task.title, newValue: title, taskTitle: task.title });
    }
    if (statusId !== undefined && statusId !== task.statusId) {
      const oldStatus = await ctx.db.get(task.statusId);
      const newStatus = await ctx.db.get(statusId);
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "status_change",
        oldValue: oldStatus?.name ?? "Unknown",
        newValue: newStatus?.name ?? "Unknown",
        taskTitle: task.title,
      });
    }
    if (priority !== undefined && priority !== task.priority) {
      await logTaskActivity(ctx, { taskId, userId, workspaceId: task.workspaceId, type: "priority_change", oldValue: task.priority, newValue: priority, taskTitle: task.title });
    }
    if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
      const oldUser = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
      const newUser = assigneeId ? await ctx.db.get(assigneeId) : null;
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "assignee_change",
        oldValue: oldUser ? getUserDisplayName(oldUser) : undefined,
        newValue: newUser ? getUserDisplayName(newUser) : undefined,
        taskTitle: task.title,
      });
    }
    if (labels !== undefined) {
      const oldLabels = task.labels ?? [];
      const added = labels.filter((l) => !oldLabels.includes(l));
      const removed = oldLabels.filter((l) => !labels.includes(l));
      for (const label of added) {
        await logTaskActivity(ctx, { taskId, userId, workspaceId: task.workspaceId, type: "label_add", newValue: label, taskTitle: task.title });
      }
      for (const label of removed) {
        await logTaskActivity(ctx, { taskId, userId, workspaceId: task.workspaceId, type: "label_remove", oldValue: label, taskTitle: task.title });
      }
    }
    if (dueDate !== undefined && dueDate !== task.dueDate) {
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "due_date_change",
        oldValue: task.dueDate ?? undefined,
        newValue: dueDate ?? undefined,
        taskTitle: task.title,
      });
    }
    if (plannedStartDate !== undefined && plannedStartDate !== task.plannedStartDate) {
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "start_date_change",
        oldValue: task.plannedStartDate ?? undefined,
        newValue: plannedStartDate ?? undefined,
        taskTitle: task.title,
      });
    }
    if (estimate !== undefined && estimate !== task.estimate) {
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "estimate_change",
        oldValue: task.estimate !== undefined ? String(task.estimate) : undefined,
        newValue: estimate !== null ? String(estimate) : undefined,
        taskTitle: task.title,
      });
    }

    // Schedule notifications after database write
    let currentUser: any = null;

    // Assignment change notification
    const assigneeChanged = assigneeId !== undefined && assigneeId !== null && assigneeId !== task.assigneeId;
    if (assigneeChanged && assigneeId !== userId) {
      currentUser = await ctx.db.get(userId);
      await scheduleNotification(ctx, internal.taskNotifications.notifyTaskAssignment, {
        taskId,
        assigneeId,
        taskTitle: title ?? task.title,
        assignedBy: {
          name: getUserDisplayName(currentUser),
          id: userId,
        },
      });
    }

    // Status change notification (notify assignee if they didn't make the change)
    const effectiveAssignee = assigneeId === null ? undefined : (assigneeId ?? task.assigneeId);
    if (statusId !== undefined && statusId !== task.statusId && effectiveAssignee && effectiveAssignee !== userId) {
      if (!currentUser) currentUser = await ctx.db.get(userId);
      const newStatus = await ctx.db.get(statusId);
      await scheduleNotification(ctx, internal.taskNotifications.notifyTaskStatusChange, {
        taskId,
        assigneeId: effectiveAssignee,
        taskTitle: title ?? task.title,
        newStatusName: newStatus?.name ?? "Unknown",
        changedBy: {
          name: getUserDisplayName(currentUser),
          id: userId,
        },
      });
    }

    return null;
  },
});

export const notifyDescriptionMentions = mutation({
  args: {
    taskId: v.id("tasks"),
    mentionedUserIds: v.array(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, mentionedUserIds }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    const filtered = mentionedUserIds.filter((id) => id !== userId);
    if (filtered.length === 0) return null;

    // Rate limit: check if a description_mention was logged for this task recently
    const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
    const recentMentions = await auditLog.queryByActionResource(ctx, {
      action: "tasks.description_mention",
      resourceId: taskId,
      limit: 1,
      fromTimestamp: Date.now() - COOLDOWN_MS,
    });

    if (recentMentions.length > 0) return null;

    // Log the mention event for future rate-limit checks
    await logTaskActivity(ctx, {
      taskId,
      userId,
      workspaceId: task.workspaceId,
      type: "description_mention",
      taskTitle: task.title,
      newValue: filtered.join(","),
    });

    const user = await ctx.db.get(userId);
    await scheduleNotification(ctx, internal.taskNotifications.notifyUserMentions, {
      taskId,
      mentionedUserIds: filtered,
      taskTitle: task.title,
      mentionedBy: {
        name: getUserDisplayName(user),
        id: userId,
      },
      context: "task description",
    });

    return null;
  },
});

export const updatePosition = mutation({
  args: {
    taskId: v.id("tasks"),
    statusId: v.id("taskStatuses"),
    position: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, statusId, position }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    // Look up status to sync completed field both ways
    const newStatus = await ctx.db.get(statusId);
    if (!newStatus) throw new ConvexError("Status not found");

    const patchData: Record<string, any> = {
      statusId,
      position,
    };
    // Two-way sync: auto-complete/uncomplete based on destination status
    patchData.completed = newStatus.isCompleted;

    const existingPeriods: { startedAt: number; completedAt?: number }[] = task.workPeriods ?? [];
    const openPeriod = existingPeriods.find((p) => p.completedAt === undefined);

    if (newStatus.setsStartDate && !openPeriod) {
      patchData.workPeriods = [...existingPeriods, { startedAt: Date.now() }];
    } else if (newStatus.isCompleted && openPeriod) {
      patchData.workPeriods = existingPeriods.map((p: { startedAt: number; completedAt?: number }) =>
        p.completedAt === undefined ? { ...p, completedAt: Date.now() } : p
      );
    }

    await ctx.db.patch(taskId, patchData);

    // Log status change if status actually changed (kanban drag)
    if (statusId !== task.statusId) {
      const oldStatus = await ctx.db.get(task.statusId);
      await logTaskActivity(ctx, {
        taskId, userId, workspaceId: task.workspaceId, type: "status_change",
        oldValue: oldStatus?.name ?? "Unknown",
        newValue: newStatus.name,
        taskTitle: task.title,
      });
      // Notify assignee of status change (if they didn't make the change)
      if (task.assigneeId && task.assigneeId !== userId) {
        const currentUser = await ctx.db.get(userId);
        await scheduleNotification(ctx, internal.taskNotifications.notifyTaskStatusChange, {
          taskId,
          assigneeId: task.assigneeId,
          taskTitle: task.title,
          newStatusName: newStatus.name,
          changedBy: {
            name: getUserDisplayName(currentUser),
            id: userId,
          },
        });
      }
    }

    return null;
  },
});

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const listUnscheduled = query({
  args: { projectId: v.id("projects") },
  returns: v.array(enrichedTaskValidator),
  handler: async (ctx, { projectId }) => {
    const result = await checkResourceMember(ctx, "projects", projectId);
    if (!result) return [];
    const project = result.resource;

    // Fetch all non-completed tasks in this project
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project_completed", (q) =>
        q.eq("projectId", projectId).eq("completed", false)
      )
      .collect();

    // Keep only tasks with no plannedStartDate
    const unscheduled = tasks.filter((t) => t.plannedStartDate === undefined);

    // Enrich: status, assignee, projectKey, hasBlockers
    const enriched = await Promise.all(
      unscheduled.map(async (task) => {
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
          projectKey: project.key,
          hasBlockers: blockerEdges.some((e) => e.edgeType === "blocks"),
        };
      })
    );

    // Sort by priority: urgent → high → medium → low
    enriched.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      return pa - pb;
    });

    return enriched;
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const { userId, resource: task } = await requireResourceMember(ctx, "tasks", taskId);

    await logTaskActivity(ctx, {
      taskId, userId, workspaceId: task.workspaceId,
      taskTitle: task.title, type: "deleted",
    });

    await cascadeDelete.deleteWithCascade(ctx, "tasks", taskId, {
      onComplete: logCascadeSummary({
        userId, resourceType: "tasks", resourceId: taskId, scope: task.workspaceId,
      }),
    });
    return null;
  },
});
