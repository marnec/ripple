import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { generateKeyBetween } from "fractional-indexing";

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()), // BlockNote JSON
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
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Validate project membership via projectMembers.by_project_user
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Get project to access workspaceId
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new ConvexError("Project not found");

    // If no statusId: seed default statuses and get default status
    let statusId = args.statusId;
    if (!statusId) {
      // Check if statuses already exist for workspace
      const existingStatus = await ctx.db
        .query("taskStatuses")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", project.workspaceId))
        .first();

      // Seed default statuses if they don't exist
      if (!existingStatus) {
        await ctx.db.insert("taskStatuses", {
          workspaceId: project.workspaceId,
          name: "To Do",
          color: "bg-gray-500",
          order: 0,
          isDefault: true,
          isCompleted: false,
        });

        await ctx.db.insert("taskStatuses", {
          workspaceId: project.workspaceId,
          name: "In Progress",
          color: "bg-blue-500",
          order: 1,
          isDefault: false,
          isCompleted: false,
        });

        await ctx.db.insert("taskStatuses", {
          workspaceId: project.workspaceId,
          name: "Done",
          color: "bg-green-500",
          order: 2,
          isDefault: false,
          isCompleted: true,
        });
      }

      // Get default status
      const defaultStatus = await ctx.db
        .query("taskStatuses")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", project.workspaceId)
        )
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();

      if (!defaultStatus) {
        throw new ConvexError("No default status found for workspace");
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

    // Create task with all fields
    const taskId = await ctx.db.insert("tasks", {
      projectId: args.projectId,
      workspaceId: project.workspaceId,
      title: args.title,
      description: args.description,
      statusId,
      assigneeId: args.assigneeId,
      priority: args.priority ?? "medium",
      labels: args.labels,
      completed: status.isCompleted,
      creatorId: userId,
      position,
    });

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

    // Validate membership on its project
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) return null;

    // Enrich with status and assignee data
    const status = await ctx.db.get(task.statusId);
    const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;

    return {
      ...task,
      status,
      assignee,
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

    // Validate project membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", projectId).eq("userId", userId)
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

    // Enrich each task with status and assignee data
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        const status = await ctx.db.get(task.statusId);
        const assignee = task.assigneeId ? await ctx.db.get(task.assigneeId) : null;

        return {
          ...task,
          status,
          assignee,
        };
      })
    );

    // Sort by position within status groups (tasks without position sort after those with position)
    enrichedTasks.sort((a, b) => {
      const posA = a.position ?? '';
      const posB = b.position ?? '';
      return posA.localeCompare(posB) || a._creationTime - b._creationTime;
    });

    return enrichedTasks;
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
    description: v.optional(v.string()),
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
  },
  returns: v.null(),
  handler: async (ctx, { taskId, title, description, statusId, assigneeId, priority, labels, position }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const task = await ctx.db.get(taskId);
    if (!task) throw new ConvexError("Task not found");

    // Auth: validate membership on task's project
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Build patch object with only provided fields
    const patch: Partial<{
      title: string;
      description: string;
      statusId: Id<"taskStatuses">;
      assigneeId: Id<"users">;
      priority: "urgent" | "high" | "medium" | "low";
      labels: string[];
      completed: boolean;
      position: string;
    }> = {};

    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    if (priority !== undefined) patch.priority = priority;
    if (labels !== undefined) patch.labels = labels;
    if (position !== undefined) patch.position = position;

    // If statusId changed: look up new status, update completed field accordingly
    if (statusId !== undefined) {
      const newStatus = await ctx.db.get(statusId);
      if (!newStatus) throw new ConvexError("Status not found");

      patch.statusId = statusId;
      patch.completed = newStatus.isCompleted;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(taskId, patch);
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

    // Auth: validate membership
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this project");

    // Look up status to update completed field
    const newStatus = await ctx.db.get(statusId);
    if (!newStatus) throw new ConvexError("Status not found");

    await ctx.db.patch(taskId, {
      statusId,
      position,
      completed: newStatus.isCompleted,
    });

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

    // Auth: validate membership on task's project
    const membership = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", task.projectId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new ConvexError("Not a member of this project");
    }

    // Delete the task document
    await ctx.db.delete(taskId);
    return null;
  },
});
