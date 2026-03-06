import { expect, describe, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { WorkspaceRole } from "@shared/enums/roles";
import { Id } from "../../convex/_generated/dataModel";

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

    // Add project membership
    await ctx.db.insert("projectMembers", {
      userId,
      projectId,
      workspaceId,
      role: "admin",
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

  it("auto-sets startDate when moving to In Progress", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, inProgressId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Start me",
    });

    await asUser.mutation(api.tasks.update, {
      taskId,
      statusId: inProgressId,
    });

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.startDate).toBeDefined();
    // Should be today's date in ISO format
    expect(task?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

    // Activity should also be cleaned up
    const activities = await t.run(async (ctx) =>
      ctx.db
        .query("taskActivity")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(activities).toHaveLength(0);
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
    expect(result!.status.name).toBe("Todo");
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
