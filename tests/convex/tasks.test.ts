import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";

// Use fake timers so audit log component's scheduled aggregate updates
// don't fire uncontrollably and corrupt convex-test state.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Create a project with seeded statuses (mirrors projects.create logic). */
async function setupProjectWithStatuses(
  t: ReturnType<typeof createTestContext>,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    name?: string;
  },
) {
  const { workspaceId, userId, name = "Test Project" } = opts;

  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name,
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "TST",
      taskCounter: 0,
    });

    // Seed statuses matching projects.create
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const inProgressId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
      setsStartDate: true,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 2,
      isDefault: false,
      isCompleted: true,
    });

    return { projectId, todoId, inProgressId, doneId };
  });
}

describe("tasks.create", () => {
  it("creates a task with default status and sequential number", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "First task",
    });

    expect(taskId).toBeDefined();

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task).toMatchObject({
      title: "First task",
      statusId: todoId,
      completed: false,
      priority: "medium",
      number: 1,
    });

    // Second task gets number 2
    const taskId2 = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Second task",
    });

    const task2 = await t.run(async (ctx) => ctx.db.get(taskId2));
    expect(task2?.number).toBe(2);
  });

  it("stores plannedStartDate when provided", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Scheduled task",
      plannedStartDate: "2026-04-01",
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.plannedStartDate).toBe("2026-04-01");
    expect((task as any)?.startDate).toBeUndefined();
  });

  it("task created with plannedStartDate is excluded from listUnscheduled and visible in listByProject with the correct date", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Click-created task",
      plannedStartDate: "2026-05-12",
    });

    const unscheduled = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(unscheduled.map((t) => t._id)).not.toContain(taskId);

    const all = await asUser.query(api.tasks.listByProject, { projectId, hideCompleted: false });
    const created = all.find((t) => t._id === taskId);
    expect(created?.plannedStartDate).toBe("2026-05-12");
  });

  it("accepts explicit priority and labels", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Urgent bug",
      priority: "urgent",
      labels: ["bug", "frontend"],
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.priority).toBe("urgent");
    expect(task?.labels).toEqual(["bug", "frontend"]);
  });

  it("rejects unauthenticated users", async () => {
    const t = createTestContext();
    const workspaceId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Owner",
        email: "o@t.com",
      });
      return await ctx.db.insert("workspaces", {
        name: "WS",
        ownerId: userId,
      });
    });

    const projectId = await t.run(async (ctx) => {
      const uid = (await ctx.db.query("users").first())!._id;
      return await ctx.db.insert("projects", {
        name: "P",
        color: "bg-blue-500",
        workspaceId,
        creatorId: uid,
        key: "P",
        taskCounter: 0,
      });
    });

    await expect(
      t.mutation(api.tasks.create, {
        projectId,
        workspaceId,
        title: "Test",
      }),
    ).rejects.toThrow("Not authenticated");
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    await expect(
      asStranger.mutation(api.tasks.create, {
        projectId,
        workspaceId,
        title: "Forbidden",
      }),
    ).rejects.toThrow("Not a member of this workspace");
  });
});

describe("tasks.update", () => {
  it("updates title and priority", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Original",
    });

    await asUser.mutation(api.tasks.update, {
      taskId,
      title: "Updated",
      priority: "high",
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.title).toBe("Updated");
    expect(task?.priority).toBe("high");
  });

  it("syncs completed field when status changes to Done", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Complete me",
    });

    // Move to Done — completed should become true
    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.completed).toBe(true);
  });

  it("un-completes when moving back from Done to Todo", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId, doneId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Bounce",
    });

    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });
    await asUser.mutation(api.tasks.update, { taskId, statusId: todoId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.completed).toBe(false);
  });

  it("opens a work period when moving to a setsStartDate status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, inProgressId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Start me" });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.workPeriods).toHaveLength(1);
    expect(task?.workPeriods![0].startedAt).toBeTypeOf("number");
    expect(task?.workPeriods![0].completedAt).toBeUndefined();
  });

  it("closes the open work period when moving to a completed status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, inProgressId, doneId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Finish me" });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });
    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.workPeriods).toHaveLength(1);
    expect(task?.workPeriods![0].completedAt).toBeTypeOf("number");
  });

  it("appends a new work period when a completed task is restarted", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, inProgressId, doneId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Restart me" });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });
    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.workPeriods).toHaveLength(2);
    expect(task?.workPeriods![0].completedAt).toBeTypeOf("number");
    expect(task?.workPeriods![1].completedAt).toBeUndefined();
  });

  it("does not duplicate work period when moved to setsStartDate while already open", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, inProgressId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "No dupe" });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });
    await asUser.mutation(api.tasks.update, { taskId, statusId: inProgressId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.workPeriods).toHaveLength(1);
  });

  it("clears assignee when set to null", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Assigned task",
      assigneeId: userId,
    });

    await asUser.mutation(api.tasks.update, { taskId, assigneeId: null });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.assigneeId).toBeUndefined();
  });
});

describe("tasks.remove", () => {
  it("deletes the task and its activity", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Delete me",
    });

    await asUser.mutation(api.tasks.remove, { taskId });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task).toBeNull();
  });

  it("cleans up cycle associations on delete", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Cycled task",
    });
    // Create a cycle and add the task
    const cycleId = await asUser.mutation(api.cycles.create, {
      projectId,
      workspaceId,
      name: "Sprint 1",
    });
    await asUser.mutation(api.cycles.addTask, { cycleId, taskId });

    // Verify task is in cycle
    const ctBefore = await t.run(async (ctx) =>
      ctx.db
        .query("cycleTasks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(ctBefore).toHaveLength(1);

    // Delete task — should cascade
    await asUser.mutation(api.tasks.remove, { taskId });

    const ctAfter = await t.run(async (ctx) =>
      ctx.db
        .query("cycleTasks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(ctAfter).toHaveLength(0);
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Protected",
    });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    await expect(
      asStranger.mutation(api.tasks.remove, { taskId }),
    ).rejects.toThrow("Not a member of this workspace");
  });
});

describe("tasks.listUnscheduled", () => {
  it("returns tasks that have no plannedStartDate", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Unscheduled task",
    });

    const result = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(taskId);
  });

  it("excludes tasks that have a plannedStartDate", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    // One scheduled, one not
    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Scheduled",
      plannedStartDate: "2026-04-01",
    });
    const unscheduledId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Unscheduled",
    });

    const result = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(unscheduledId);
  });

  it("excludes completed tasks even when they have no plannedStartDate", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Done but unscheduled",
    });
    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });

    const result = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(result).toEqual([]);
  });

  it("sorts results by priority: urgent first, low last", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Low task", priority: "low" });
    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Urgent task", priority: "urgent" });
    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Medium task", priority: "medium" });
    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "High task", priority: "high" });

    const result = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(result.map((t) => t.priority)).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("returns empty array for non-workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "Private task" });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    const result = await asStranger.query(api.tasks.listUnscheduled, { projectId });
    expect(result).toEqual([]);
  });

  it("returns empty array when all tasks have a plannedStartDate", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Already scheduled",
      plannedStartDate: "2026-04-01",
    });

    const result = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(result).toEqual([]);
  });
});

describe("tasks.get", () => {
  it("returns enriched task for workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Enriched",
    });

    const result = await asUser.query(api.tasks.get, { taskId });
    expect(result).toBeDefined();
    expect(result!.title).toBe("Enriched");
    expect(result!.status).toBeDefined();
    expect(result!.status!.name).toBe("Todo");
    expect(result!.projectKey).toBe("TST");
  });

  it("returns null for non-members", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Secret",
    });

    const { asUser: asStranger } = await setupAuthenticatedUser(t, {
      name: "Stranger",
      email: "stranger@test.com",
    });

    const result = await asStranger.query(api.tasks.get, { taskId });
    expect(result).toBeNull();
  });
});
