import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * Cycle progress is `completed / total` read from the `tasksByCycle` aggregate,
 * so the three subscribed queries that report it (`get`, `listByProject`,
 * `listForCalendar`) never read the cycle's tasks. That makes the aggregate
 * trigger the load-bearing part: if it stops firing, progress silently freezes
 * and no query throws. These tests drive the real mutations and read the real
 * queries, so they fail if the trigger is dropped.
 */

type T = ReturnType<typeof createTestContext>;

async function setupCycleFixture(t: T) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

  const { projectId, todoId, doneId } = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test Project",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "TST",
      taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 1,
      isDefault: false,
      isCompleted: true,
    });
    return { projectId, todoId, doneId };
  });

  const cycleId = await asUser.mutation(api.cycles.create, {
    projectId,
    workspaceId,
    name: "Sprint 1",
    dueDate: "2030-01-31",
  });

  const createTask = (title: string, statusId: Id<"taskStatuses"> = todoId) =>
    asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title,
      statusId,
    });

  return { workspaceId, userId, asUser, projectId, todoId, doneId, cycleId, createTask };
}

describe("cycle progress", () => {
  it("follows a task's completion across all three progress queries", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    const a = await f.createTask("A");
    const b = await f.createTask("B");
    for (const taskId of [a, b]) {
      await f.asUser.mutation(api.cycles.addTasks, { cycleId: f.cycleId, taskIds: [taskId] });
    }

    const readAll = async () => {
      const [one, list, calendar] = await Promise.all([
        f.asUser.query(api.cycles.get, { cycleId: f.cycleId }),
        f.asUser.query(api.cycles.listByProject, { projectId: f.projectId }),
        f.asUser.query(api.cycles.listForCalendar, { projectId: f.projectId }),
      ]);
      return [one!, list[0], calendar.cycles[0]];
    };

    for (const cycle of await readAll()) {
      expect(cycle).toMatchObject({
        totalTasks: 2,
        completedTasks: 0,
        progressPercent: 0,
      });
    }

    // The whole point of the aggregate: this write must reach it.
    await f.asUser.mutation(api.tasks.update, { taskId: a, statusId: f.doneId });

    for (const cycle of await readAll()) {
      expect(cycle).toMatchObject({
        totalTasks: 2,
        completedTasks: 1,
        progressPercent: 50,
      });
    }

    // …and back again, so the fan-out isn't one-way.
    await f.asUser.mutation(api.tasks.update, { taskId: a, statusId: f.todoId });
    for (const cycle of await readAll()) {
      expect(cycle).toMatchObject({ completedTasks: 0, progressPercent: 0 });
    }
  });

  it("counts a task that was already complete when it joined the cycle", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    // Completed first, moved second — the move must carry the completed flag
    // into the cycle's namespace, not just the count.
    const done = await f.createTask("Already done", f.doneId);
    await f.asUser.mutation(api.cycles.addTasks, { cycleId: f.cycleId, taskIds: [done] });

    const cycle = await f.asUser.query(api.cycles.get, { cycleId: f.cycleId });
    expect(cycle).toMatchObject({
      totalTasks: 1,
      completedTasks: 1,
      progressPercent: 100,
    });
  });

  it("stops counting a task once it leaves the cycle", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    const done = await f.createTask("Done", f.doneId);
    const open = await f.createTask("Open");
    for (const taskId of [done, open]) {
      await f.asUser.mutation(api.cycles.addTasks, { cycleId: f.cycleId, taskIds: [taskId] });
    }
    await f.asUser.mutation(api.cycles.removeTask, {
      cycleId: f.cycleId,
      taskId: done,
    });

    expect(
      await f.asUser.query(api.cycles.get, { cycleId: f.cycleId }),
    ).toMatchObject({ totalTasks: 1, completedTasks: 0, progressPercent: 0 });
  });

  it("still enriches cycle tasks with status, assignee and blockers", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    const open = await f.createTask("Open");
    const done = await f.createTask("Done", f.doneId);
    for (const taskId of [open, done]) {
      await f.asUser.mutation(api.cycles.addTasks, { cycleId: f.cycleId, taskIds: [taskId] });
    }
    await f.asUser.mutation(api.tasks.update, {
      taskId: open,
      assigneeId: f.userId,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("edges", {
        sourceType: "task",
        sourceId: done,
        targetType: "task",
        targetId: open,
        edgeType: "blocks",
        workspaceId: f.workspaceId,
        createdAt: 0,
      });
    });

    const enriched = await f.asUser.query(api.cycles.listCycleTasks, {
      cycleId: f.cycleId,
    });
    const byTitle = new Map(enriched.map((task) => [task.title, task]));

    expect(byTitle.get("Open")).toMatchObject({
      status: expect.objectContaining({ name: "Todo" }),
      assignee: expect.objectContaining({ _id: f.userId }),
      projectKey: "TST",
      hasBlockers: true,
    });
    expect(byTitle.get("Done")).toMatchObject({
      status: expect.objectContaining({ name: "Done" }),
      assignee: null,
      hasBlockers: false,
    });

    const openOnly = await f.asUser.query(api.cycles.listCycleTasks, {
      cycleId: f.cycleId,
      hideCompleted: true,
    });
    expect(openOnly.map((task) => task.title)).toEqual(["Open"]);
  });

  it("counts the backlog apart from cycles, and follows completion and moves", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    const a = await f.createTask("A");
    const b = await f.createTask("B");
    await f.createTask("C");
    await f.asUser.mutation(api.cycles.addTasks, { cycleId: f.cycleId, taskIds: [a] });
    await f.asUser.mutation(api.tasks.update, { taskId: b, statusId: f.doneId });

    expect(
      await f.asUser.query(api.cycles.backlogSize, { projectId: f.projectId }),
    ).toEqual({ total: 2, open: 1 });
  });

  it("hides the backlog size from non-members", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    await f.createTask("A");

    const { asUser: outsider } = await setupWorkspaceWithAdmin(t);
    expect(
      await outsider.query(api.cycles.backlogSize, { projectId: f.projectId }),
    ).toBeNull();
  });
});
