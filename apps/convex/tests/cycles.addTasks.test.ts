import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupAuthenticatedUser, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

type T = ReturnType<typeof createTestContext>;

async function setupCycleFixture(t: T) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

  const seedProject = (key: string) =>
    t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        name: `Project ${key}`,
        color: "bg-blue-500",
        workspaceId,
        creatorId: userId,
        key,
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

  const { projectId, doneId } = await seedProject("TST");

  const cycleId = await asUser.mutation(api.cycles.create, {
    projectId,
    workspaceId,
    name: "Sprint 1",
    dueDate: "2030-01-31",
  });

  const createTask = (title: string, opts: { projectId?: Id<"projects">; done?: boolean } = {}) =>
    asUser.mutation(api.tasks.create, {
      projectId: opts.projectId ?? projectId,
      workspaceId,
      title,
      ...(opts.done ? { statusId: doneId } : {}),
    });

  const cycleTaskIds = async () =>
    (await asUser.query(api.cycles.listCycleTasks, { cycleId, hideCompleted: false })).map(
      (task) => task._id,
    );

  return { workspaceId, userId, asUser, projectId, cycleId, createTask, seedProject, cycleTaskIds };
}

describe("cycles.addTasks", () => {
  it("files the whole selection in one call and reports how many were new", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    const a = await f.createTask("A");
    const b = await f.createTask("B");

    const added = await f.asUser.mutation(api.cycles.addTasks, {
      cycleId: f.cycleId,
      taskIds: [a, b, a],
    });
    expect(added).toBe(2);
    expect(new Set(await f.cycleTaskIds())).toEqual(new Set([a, b]));

    // Idempotent: already-present tasks are skipped, not errors.
    const again = await f.asUser.mutation(api.cycles.addTasks, {
      cycleId: f.cycleId,
      taskIds: [a, b],
    });
    expect(again).toBe(0);
    expect(await f.cycleTaskIds()).toHaveLength(2);
  });

  it("refuses a task from another project, leaving the rest unwritten", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    const other = await f.seedProject("OTH");
    const local = await f.createTask("local");
    const foreign = await f.createTask("foreign", { projectId: other.projectId });

    await expect(
      f.asUser.mutation(api.cycles.addTasks, {
        cycleId: f.cycleId,
        taskIds: [local, foreign],
      }),
    ).rejects.toThrow(/does not belong/);
    // The mutation is one transaction: the local task was rolled back too.
    expect(await f.cycleTaskIds()).toEqual([]);
  });
});

describe("cycles.suggestAddableTasks", () => {
  it("browse: the project's active tasks not yet in the cycle, newest first", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    const other = await f.seedProject("OTH");

    const older = await f.createTask("older");
    const inCycle = await f.createTask("in cycle");
    await f.createTask("done", { done: true });
    await f.createTask("elsewhere", { projectId: other.projectId });
    const newer = await f.createTask("newer");
    await f.asUser.mutation(api.cycles.addTask, { cycleId: f.cycleId, taskId: inCycle });

    const result = await f.asUser.query(api.cycles.suggestAddableTasks, { cycleId: f.cycleId });
    expect(result.map((task) => task._id)).toEqual([newer, older]);
    expect(result[0]).toMatchObject({
      title: "newer",
      completed: false,
      statusColor: "bg-gray-500",
      projectKey: "TST",
    });
  });

  it("browse: still fills the page when the cycle already holds the newest tasks", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);

    const free = await f.createTask("free");
    for (let i = 0; i < 3; i++) {
      const id = await f.createTask(`taken-${i}`);
      await f.asUser.mutation(api.cycles.addTask, { cycleId: f.cycleId, taskId: id });
    }

    // limit 1 with three newer tasks already in the cycle: without headroom
    // the page would be the newest row, dropped, and come back empty.
    const result = await f.asUser.query(api.cycles.suggestAddableTasks, {
      cycleId: f.cycleId,
      limit: 1,
    });
    expect(result.map((task) => task._id)).toEqual([free]);
  });

  it("search: matches completed tasks too, scoped to the project, minus the cycle", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    const other = await f.seedProject("OTH");

    const activeHit = await f.createTask("migration active");
    const doneHit = await f.createTask("migration finished", { done: true });
    const inCycle = await f.createTask("migration planned");
    await f.createTask("migration elsewhere", { projectId: other.projectId });
    await f.createTask("unrelated");
    await f.asUser.mutation(api.cycles.addTask, { cycleId: f.cycleId, taskId: inCycle });

    const result = await f.asUser.query(api.cycles.suggestAddableTasks, {
      cycleId: f.cycleId,
      query: "migration",
    });
    expect(new Set(result.map((task) => task._id))).toEqual(new Set([activeHit, doneHit]));
    expect(result.find((task) => task._id === doneHit)?.completed).toBe(true);
  });

  it("returns nothing to a non-member", async () => {
    const t = createTestContext();
    const f = await setupCycleFixture(t);
    await f.createTask("A");
    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    const result = await asOutsider.query(api.cycles.suggestAddableTasks, { cycleId: f.cycleId });
    expect(result).toEqual([]);
  });
});
