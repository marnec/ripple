import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * The backlog model: a task is in at most one cycle (`tasks.cycleId`), none is
 * the backlog, cycles are closed by hand, and one open cycle is the project's
 * current one.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof createTestContext>;

async function setup(t: T) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await asUser.mutation(api.projects.create, {
    name: "Engine",
    color: "bg-blue-500",
    workspaceId,
    key: "ENG",
  });
  const statuses = await t.run((ctx) =>
    ctx.db
      .query("taskStatuses")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect(),
  );
  const doneId = statuses.find((s) => s.isCompleted)!._id;
  const project = await t.run((ctx) => ctx.db.get(projectId));
  const firstCycleId = project!.currentCycleId!;

  const createTask = (
    title: string,
    opts: { cycleId?: Id<"cycles">; done?: boolean; tags?: string[] } = {},
  ) =>
    asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title,
      cycleId: opts.cycleId,
      tags: opts.tags,
      ...(opts.done ? { statusId: doneId } : {}),
    });

  const cycleOf = async (taskId: Id<"tasks">) =>
    (await t.run((ctx) => ctx.db.get(taskId)))?.cycleId;
  const currentCycle = async () =>
    (await t.run((ctx) => ctx.db.get(projectId)))?.currentCycleId;
  const board = async (cycleId: Id<"cycles"> | null, completed = false) =>
    (await asUser.query(api.tasks.listByProject, { projectId, completed, cycleId })).map(
      (task) => task.title,
    );

  return {
    workspaceId, userId, asUser, projectId, doneId, firstCycleId,
    createTask, cycleOf, currentCycle, board,
  };
}

describe("project defaults", () => {
  it("a new project starts with an open Cycle 1 as its current cycle", async () => {
    const t = createTestContext();
    const f = await setup(t);

    const cycles = await f.asUser.query(api.cycles.listByProject, { projectId: f.projectId });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      _id: f.firstCycleId,
      name: "Cycle 1",
      status: "open",
      isCurrent: true,
    });
  });

  it("tasks land in the backlog unless created into a cycle", async () => {
    const t = createTestContext();
    const f = await setup(t);

    await f.createTask("loose");
    await f.createTask("planned", { cycleId: f.firstCycleId });

    expect(await f.board(null)).toEqual(["loose"]);
    expect(await f.board(f.firstCycleId)).toEqual(["planned"]);
  });
});

describe("moving tasks", () => {
  it("moves between cycles and the backlog, and progress follows", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.asUser.mutation(api.cycles.create, {
      projectId: f.projectId,
      workspaceId: f.workspaceId,
    });
    const a = await f.createTask("a");
    const b = await f.createTask("b", { done: true });

    expect(
      await f.asUser.mutation(api.cycles.moveTasks, {
        projectId: f.projectId,
        taskIds: [a, b],
        cycleId: f.firstCycleId,
      }),
    ).toBe(2);
    expect(await f.asUser.query(api.cycles.get, { cycleId: f.firstCycleId })).toMatchObject({
      totalTasks: 2, completedTasks: 1, progressPercent: 50,
    });

    await f.asUser.mutation(api.cycles.moveTasks, {
      projectId: f.projectId, taskIds: [b], cycleId: second,
    });
    expect(await f.cycleOf(b)).toBe(second);
    expect(await f.asUser.query(api.cycles.get, { cycleId: f.firstCycleId })).toMatchObject({
      totalTasks: 1, completedTasks: 0,
    });

    await f.asUser.mutation(api.cycles.moveTasks, {
      projectId: f.projectId, taskIds: [a], cycleId: null,
    });
    expect(await f.cycleOf(a)).toBeUndefined();
    expect(await f.board(null)).toEqual(["a"]);
  });

  it("keeps a cycle-scoped tag filter in step with the move", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const tagged = await f.createTask("tagged", { tags: ["infra"] });

    const byTag = (cycleId: Id<"cycles"> | null) =>
      f.asUser.query(api.tasks.listByProject, {
        projectId: f.projectId, completed: false, cycleId, tagNames: ["infra"],
      });

    expect((await byTag(null)).map((task) => task._id)).toEqual([tagged]);
    await f.asUser.mutation(api.cycles.moveTasks, {
      projectId: f.projectId, taskIds: [tagged], cycleId: f.firstCycleId,
    });
    expect(await byTag(null)).toEqual([]);
    expect((await byTag(f.firstCycleId)).map((task) => task._id)).toEqual([tagged]);
  });

  it("refuses to file into a closed cycle", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const task = await f.createTask("late");
    await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId, unfinishedTo: { kind: "backlog" },
    });

    await expect(
      f.asUser.mutation(api.cycles.moveTasks, {
        projectId: f.projectId, taskIds: [task], cycleId: f.firstCycleId,
      }),
    ).rejects.toThrow(/closed/);
    await expect(f.createTask("new", { cycleId: f.firstCycleId })).rejects.toThrow(/closed/);
  });

  it("bulk moveToCycle drains the whole selection", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const ids: Id<"tasks">[] = [];
    for (let i = 0; i < 13; i++) ids.push(await f.createTask(`t${i}`));

    await f.asUser.mutation(api.taskBulk.apply, {
      projectId: f.projectId,
      taskIds: ids,
      op: { kind: "moveToCycle", cycleId: f.firstCycleId },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const id of ids) expect(await f.cycleOf(id)).toBe(f.firstCycleId);
  });
});

describe("closing a cycle", () => {
  it("keeps completed work, sends unfinished work to the backlog, and hands over current", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const later = await f.asUser.mutation(api.cycles.create, {
      projectId: f.projectId, workspaceId: f.workspaceId,
    });
    const done = await f.createTask("done", { cycleId: f.firstCycleId, done: true });
    const open = await f.createTask("open", { cycleId: f.firstCycleId });

    const result = await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId, unfinishedTo: { kind: "backlog" },
    });

    expect(result).toEqual({ moved: 1, destinationCycleId: null });
    expect(await f.cycleOf(done)).toBe(f.firstCycleId);
    expect(await f.cycleOf(open)).toBeUndefined();
    // No destination cycle: the oldest other open cycle takes over.
    expect(await f.currentCycle()).toBe(later);
    expect(await f.asUser.query(api.cycles.get, { cycleId: f.firstCycleId })).toMatchObject({
      status: "closed", totalTasks: 1, completedTasks: 1, isCurrent: false,
    });
  });

  it("can carry unfinished work into a new cycle, which becomes current", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const open = await f.createTask("open", { cycleId: f.firstCycleId });

    const { destinationCycleId } = await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId, unfinishedTo: { kind: "newCycle" },
    });

    expect(destinationCycleId).not.toBeNull();
    expect(await f.cycleOf(open)).toBe(destinationCycleId);
    expect(await f.currentCycle()).toBe(destinationCycleId);
    expect(
      (await f.asUser.query(api.cycles.get, { cycleId: destinationCycleId! }))?.name,
    ).toBe("Cycle 2");
  });

  it("refuses to carry work into the cycle being closed", async () => {
    const t = createTestContext();
    const f = await setup(t);
    await expect(
      f.asUser.mutation(api.cycles.close, {
        cycleId: f.firstCycleId,
        unfinishedTo: { kind: "cycle", cycleId: f.firstCycleId },
      }),
    ).rejects.toThrow();
  });

  it("closing the last open cycle leaves no current cycle; reopening restores it", async () => {
    const t = createTestContext();
    const f = await setup(t);

    await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId, unfinishedTo: { kind: "backlog" },
    });
    expect(await f.currentCycle()).toBeUndefined();

    await f.asUser.mutation(api.cycles.reopen, { cycleId: f.firstCycleId });
    expect(await f.currentCycle()).toBe(f.firstCycleId);
  });
});

describe("deleting a cycle", () => {
  it("sends all its tasks to the backlog", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.asUser.mutation(api.cycles.create, {
      projectId: f.projectId, workspaceId: f.workspaceId,
    });
    const done = await f.createTask("done", { cycleId: second, done: true });
    const open = await f.createTask("open", { cycleId: second });

    await f.asUser.mutation(api.cycles.remove, { cycleId: second });

    expect(await f.cycleOf(done)).toBeUndefined();
    expect(await f.cycleOf(open)).toBeUndefined();
  });

  it("refuses to delete a project's last cycle", async () => {
    const t = createTestContext();
    const f = await setup(t);
    await expect(
      f.asUser.mutation(api.cycles.remove, { cycleId: f.firstCycleId }),
    ).rejects.toThrow(/at least one cycle/);
  });
});

describe("migrateCyclesToBacklogModel", () => {
  async function seedLegacy(t: T) {
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        name: "Legacy", color: "bg-blue-500", workspaceId, creatorId: userId, key: "LEG", taskCounter: 0,
      });
      await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      const doneId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Done", color: "bg-green-500", order: 1, isDefault: false, isCompleted: true,
      });
      return { projectId, doneId };
    });

    // Created through the API so they enter the aggregates the way real rows
    // did — in the backlog namespace, since nothing set a cycle on them.
    const task = (title: string, opts: { done?: boolean; tags?: string[] } = {}) =>
      asUser.mutation(api.tasks.create, {
        projectId, workspaceId, title, tags: opts.tags,
        ...(opts.done ? { statusId: doneId } : {}),
      });
    const inActive = await task("in active", { tags: ["infra"] });
    const doneInPast = await task("done in past", { done: true });
    const openInPast = await task("open in past");
    const loose = await task("loose");
    const inDraftAndActive = await task("draft and active");

    const cycles = await t.run(async (ctx) => {
      const base = { projectId, workspaceId, creatorId: userId };
      const past = await ctx.db.insert("cycles", {
        ...base, name: "Past", status: "completed", startDate: "2020-01-01", dueDate: "2020-01-31",
      });
      const active = await ctx.db.insert("cycles", {
        ...base, name: "Now", status: "active", startDate: "2026-01-01",
      });
      const draft = await ctx.db.insert("cycles", { ...base, name: "Someday", status: "draft" });
      const join = (cycleId: Id<"cycles">, taskId: Id<"tasks">) =>
        ctx.db.insert("cycleTasks", { cycleId, taskId, projectId, addedBy: userId });
      await join(active, inActive);
      await join(past, doneInPast);
      await join(past, openInPast);
      await join(draft, inDraftAndActive);
      await join(active, inDraftAndActive);
      return { past, active, draft };
    });

    return {
      asUser, projectId, cycles,
      tasks: { inActive, doneInPast, openInPast, loose, inDraftAndActive },
    };
  }

  const migrate = async (t: T) => {
    await t.mutation(internal.migrations.migrateCyclesToBacklogModel, { cursor: null, batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  };

  it("assigns every task one cycle and keeps the board as it was", async () => {
    const t = createTestContext();
    const s = await seedLegacy(t);
    await migrate(t);

    const cycleOf = async (id: Id<"tasks">) => (await t.run((ctx) => ctx.db.get(id)))?.cycleId;
    expect(await cycleOf(s.tasks.inActive)).toBe(s.cycles.active);
    expect(await cycleOf(s.tasks.doneInPast)).toBe(s.cycles.past);
    // Unfinished work only in a closed cycle, and work in no cycle at all, both
    // land on the current cycle's board.
    expect(await cycleOf(s.tasks.openInPast)).toBe(s.cycles.active);
    expect(await cycleOf(s.tasks.loose)).toBe(s.cycles.active);
    // In two open cycles: the current one wins, so it stays on the board.
    expect(await cycleOf(s.tasks.inDraftAndActive)).toBe(s.cycles.active);

    const project = await t.run((ctx) => ctx.db.get(s.projectId));
    expect(project?.currentCycleId).toBe(s.cycles.active);

    const cycles = await s.asUser.query(api.cycles.listByProject, { projectId: s.projectId });
    const byName = new Map(cycles.map((c) => [c.name, c]));
    expect(byName.get("Past")).toMatchObject({ status: "closed", totalTasks: 1, completedTasks: 1 });
    expect(byName.get("Now")).toMatchObject({ status: "open", isCurrent: true, totalTasks: 4 });
    expect(byName.get("Someday")).toMatchObject({ status: "open", totalTasks: 0 });

    // The tag join was moved by hand (no triggers in a migration).
    const tagged = await s.asUser.query(api.tasks.listByProject, {
      projectId: s.projectId, completed: false, cycleId: s.cycles.active, tagNames: ["infra"],
    });
    expect(tagged.map((task) => task._id)).toEqual([s.tasks.inActive]);

    const leftover = await t.run((ctx) => ctx.db.query("cycleTasks").collect());
    expect(leftover).toEqual([]);
  });

  it("does not touch a project that is already migrated", async () => {
    const t = createTestContext();
    const s = await seedLegacy(t);
    await migrate(t);

    await s.asUser.mutation(api.cycles.moveTasks, {
      projectId: s.projectId, taskIds: [s.tasks.loose], cycleId: null,
    });
    await migrate(t);

    expect((await t.run((ctx) => ctx.db.get(s.tasks.loose)))?.cycleId).toBeUndefined();
  });

  it("gives a project that never had cycles a current Cycle 1 holding all its tasks", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        name: "Plain", color: "bg-blue-500", workspaceId, creatorId: userId, key: "PLN", taskCounter: 0,
      });
      await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      return projectId;
    });
    const taskId = await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: "x" });

    await migrate(t);

    const cycles = await asUser.query(api.cycles.listByProject, { projectId });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ name: "Cycle 1", isCurrent: true, totalTasks: 1 });
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.cycleId).toBe(cycles[0]._id);
  });
});
