import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

import { generateKeyBetween } from "fractional-indexing";
import { getUserDisplayName } from "@shared/displayName";
import { insertActivity } from "./taskActivity";

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
    startDate: v.optional(v.string()),
    estimate: v.optional(v.number()),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this workspace");
    }

    // Get project to access workspaceId
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project not found");

    // If no statusId provided, fetch the default status for the project
    let statusId = args.statusId;
    if (!statusId) {
      const defaultStatus = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("isDefault"), true))
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

    // Atomically assign sequential task number
    const counter = project.taskCounter ?? 0;
    const nextNumber = counter + 1;
    await ctx.db.patch(args.projectId, { taskCounter: nextNumber });

    // Create task with all fields
    const taskId = await ctx.db.insert("tasks", {
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
      startDate: args.startDate,
      estimate: args.estimate,
    });

    // Log task creation activity
    await insertActivity(ctx, { taskId, userId, type: "created" });

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
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const task = await ctx.db.get(taskId);
    if (!task) return null;

    // Validate workspace membership using task's denormalized workspaceId
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) return null;

    // Enrich with status, assignee, project key, and blocker status
    const status = await ctx.db.get(task.statusId);
    const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
    const project = await ctx.db.get(task.projectId);

    // Check if this task has any blockers (incoming "blocks" dependencies)
    const blocker = await ctx.db
      .query("taskDependencies")
      .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", taskId))
      .first();
    const hasBlockers = blocker?.type === "blocks";

    return {
      ...task,
      status,
      assignee,
      projectKey: project?.key,
      hasBlockers,
    };
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    hideCompleted: v.optional(v.boolean()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { projectId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Resolve the project to get workspaceId for membership check
    const project = await ctx.db.get(projectId);
    if (!project) return [];

    // Validate workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) return [];

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
        const blocker = await ctx.db
          .query("taskDependencies")
          .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", task._id))
          .first();

        return {
          ...task,
          status,
          assignee,
          projectKey: project.key,
          hasBlockers: blocker?.type === "blocks",
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
  returns: v.array(v.any()),
  handler: async (ctx, { workspaceId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) return [];

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
  returns: v.array(v.any()),
  handler: async (ctx, { workspaceId, hideCompleted }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

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
    startDate: v.optional(v.union(v.string(), v.null())),
    estimate: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { taskId, title, statusId, assigneeId, priority, labels, position, dueDate, startDate, estimate }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Auth: validate workspace membership using task's denormalized workspaceId
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this workspace");
    }

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
    if (startDate === null) patch.startDate = undefined;
    else if (startDate !== undefined) patch.startDate = startDate;
    if (estimate === null) patch.estimate = undefined;
    else if (estimate !== undefined) patch.estimate = estimate;

    // If statusId changed: look up new status, sync completed field both ways
    if (statusId !== undefined) {
      const newStatus = await ctx.db.get(statusId);
      if (!newStatus) throw new ConvexError("Status not found");

      patch.statusId = statusId;
      // Two-way sync: auto-complete when moving TO a completed status,
      // auto-uncomplete when moving to a non-completed status
      patch.completed = newStatus.isCompleted;
      // Auto-set startDate when moving to a status with setsStartDate, if not already set
      if (newStatus.setsStartDate && !task.startDate && startDate === undefined) {
        patch.startDate = new Date().toISOString().slice(0, 10);
      }
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(taskId, patch);
    }

    // Log activity for each changed field
    if (title !== undefined && title !== task.title) {
      await insertActivity(ctx, { taskId, userId, type: "title_change", oldValue: task.title, newValue: title });
    }
    if (statusId !== undefined && statusId !== task.statusId) {
      const oldStatus = await ctx.db.get(task.statusId);
      const newStatus = await ctx.db.get(statusId);
      await insertActivity(ctx, {
        taskId, userId, type: "status_change",
        oldValue: oldStatus?.name ?? "Unknown",
        newValue: newStatus?.name ?? "Unknown",
      });
    }
    if (priority !== undefined && priority !== task.priority) {
      await insertActivity(ctx, { taskId, userId, type: "priority_change", oldValue: task.priority, newValue: priority });
    }
    if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
      const oldUser = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;
      const newUser = assigneeId ? await ctx.db.get(assigneeId) : null;
      await insertActivity(ctx, {
        taskId, userId, type: "assignee_change",
        oldValue: oldUser ? getUserDisplayName(oldUser) : undefined,
        newValue: newUser ? getUserDisplayName(newUser) : undefined,
      });
    }
    if (labels !== undefined) {
      const oldLabels = task.labels ?? [];
      const added = labels.filter((l) => !oldLabels.includes(l));
      const removed = oldLabels.filter((l) => !labels.includes(l));
      for (const label of added) {
        await insertActivity(ctx, { taskId, userId, type: "label_add", newValue: label });
      }
      for (const label of removed) {
        await insertActivity(ctx, { taskId, userId, type: "label_remove", oldValue: label });
      }
    }
    if (dueDate !== undefined && dueDate !== task.dueDate) {
      await insertActivity(ctx, {
        taskId, userId, type: "due_date_change",
        oldValue: task.dueDate ?? undefined,
        newValue: dueDate ?? undefined,
      });
    }
    if ((startDate !== undefined && startDate !== task.startDate) ||
        (patch.startDate !== undefined && !task.startDate)) {
      await insertActivity(ctx, {
        taskId, userId, type: "start_date_change",
        oldValue: task.startDate ?? undefined,
        newValue: (startDate ?? patch.startDate) ?? undefined,
      });
    }
    if (estimate !== undefined && estimate !== task.estimate) {
      await insertActivity(ctx, {
        taskId, userId, type: "estimate_change",
        oldValue: task.estimate !== undefined ? String(task.estimate) : undefined,
        newValue: estimate !== null ? String(estimate) : undefined,
      });
    }

    // Schedule notifications after database write
    let currentUser: any = null;

    // Assignment change notification
    const assigneeChanged = assigneeId !== undefined && assigneeId !== null && assigneeId !== task.assigneeId;
    if (assigneeChanged && assigneeId !== userId) {
      currentUser = await ctx.db.get(userId);
      await ctx.scheduler.runAfter(0, internal.taskNotifications.notifyTaskAssignment, {
        taskId,
        assigneeId,
        taskTitle: title ?? task.title,
        assignedBy: {
          name: getUserDisplayName(currentUser),
          id: userId,
        },
      });
    }

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Auth: validate workspace membership using task's denormalized workspaceId
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Look up status to sync completed field both ways
    const newStatus = await ctx.db.get(statusId);
    if (!newStatus) throw new ConvexError("Status not found");

    const patchData: Record<string, any> = {
      statusId,
      position,
    };
    // Two-way sync: auto-complete/uncomplete based on destination status
    patchData.completed = newStatus.isCompleted;
    // Auto-set startDate when moving to a status with setsStartDate, if not already set
    if (newStatus.setsStartDate && !task.startDate) {
      patchData.startDate = new Date().toISOString().slice(0, 10);
    }
    await ctx.db.patch(taskId, patchData);

    // Log status change if status actually changed (kanban drag)
    if (statusId !== task.statusId) {
      const oldStatus = await ctx.db.get(task.statusId);
      await insertActivity(ctx, {
        taskId, userId, type: "status_change",
        oldValue: oldStatus?.name ?? "Unknown",
        newValue: newStatus.name,
      });
      // Log auto-set start date
      if (patchData.startDate && !task.startDate) {
        await insertActivity(ctx, {
          taskId, userId, type: "start_date_change",
          newValue: patchData.startDate,
        });
      }
    }

    return null;
  },
});

export const remove = mutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Auth: validate workspace membership using task's denormalized workspaceId
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this workspace");
    }

    // Clean up task activity
    const taskActivities = await ctx.db
      .query("taskActivity")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    await Promise.all(taskActivities.map((a) => ctx.db.delete(a._id)));

    // Clean up task comments
    const taskComments = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    await Promise.all(taskComments.map((comment) => ctx.db.delete(comment._id)));

    // Clean up Yjs snapshot from storage
    if (task.yjsSnapshotId) {
      await ctx.storage.delete(task.yjsSnapshotId);
    }

    // Clean up outgoing content references from this task
    const outgoingRefs = await ctx.db
      .query("contentReferences")
      .withIndex("by_source", (q) => q.eq("sourceId", taskId))
      .collect();
    await Promise.all(outgoingRefs.map((r) => ctx.db.delete(r._id)));

    // Clean up task dependencies (both directions)
    const outgoingDeps = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    const incomingDeps = await ctx.db
      .query("taskDependencies")
      .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", taskId))
      .collect();
    await Promise.all(
      [...outgoingDeps, ...incomingDeps].map((dep) => ctx.db.delete(dep._id))
    );

    // Delete the task document
    await ctx.db.delete(taskId);
    return null;
  },
});
