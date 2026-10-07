import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * A cycle's membership over time must be rebuildable from its audit entries:
 * every way a task enters or leaves a cycle records the task's id, and the
 * moment a cycle becomes current — its start — is logged. Cycle reports
 * (scope change, carry-over) read this history; titles in old/newValue are
 * for display only.
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

  const createTask = (title: string, opts: { cycleId?: Id<"cycles">; done?: boolean } = {}) =>
    asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title,
      cycleId: opts.cycleId,
      ...(opts.done ? { statusId: doneId } : {}),
    });

  const createCycle = () =>
    asUser.mutation(api.cycles.create, { projectId, workspaceId });

  /** The cycle's audit entries, reduced to what reports read. */
  const history = async (cycleId: Id<"cycles">) => {
    const rows = await t.run((ctx) =>
      auditLog.queryByResource(ctx, { resourceType: "cycles", resourceId: cycleId }),
    );
    return (rows as Array<{
      action: string;
      actorId?: string;
      metadata?: { taskIds?: string[] };
    }>)
      .map((r) => ({
        action: r.action.replace(/^cycles\./, ""),
        actorId: r.actorId,
        taskIds: r.metadata?.taskIds,
      }));
  };
  const entry = async (cycleId: Id<"cycles">, action: string) =>
    (await history(cycleId)).filter((e) => e.action === action);

  return {
    workspaceId, userId, asUser, projectId, firstCycleId,
    createTask, createCycle, history, entry,
  };
}

describe("cycle membership history", () => {
  it("a task created into a cycle is recorded as added, by id", async () => {
    const t = createTestContext();
    const f = await setup(t);

    const taskId = await f.createTask("Spec", { cycleId: f.firstCycleId });
    await f.createTask("Backlog item");

    expect(await f.entry(f.firstCycleId, "task_added")).toEqual([
      expect.objectContaining({ taskIds: [taskId] }),
    ]);
  });

  it("moving a task records it leaving one cycle and entering the other", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.createCycle();
    const taskId = await f.createTask("Spec", { cycleId: f.firstCycleId });

    await f.asUser.mutation(api.cycles.moveTasks, {
      projectId: f.projectId, taskIds: [taskId], cycleId: second,
    });

    expect(await f.entry(f.firstCycleId, "task_removed")).toEqual([
      expect.objectContaining({ taskIds: [taskId] }),
    ]);
    expect(await f.entry(second, "task_added")).toEqual([
      expect.objectContaining({ taskIds: [taskId] }),
    ]);
  });

  it("closing into another cycle records the carried tasks on both sides", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const next = await f.createCycle();
    const open1 = await f.createTask("Open 1", { cycleId: f.firstCycleId });
    const open2 = await f.createTask("Open 2", { cycleId: f.firstCycleId });
    await f.createTask("Shipped", { cycleId: f.firstCycleId, done: true });

    await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId,
      unfinishedTo: { kind: "cycle", cycleId: next },
    });

    const [closed] = await f.entry(f.firstCycleId, "closed");
    expect(closed.taskIds?.slice().sort()).toEqual([open1, open2].sort());
    const [carried] = await f.entry(next, "carried_in");
    expect(carried.taskIds?.slice().sort()).toEqual([open1, open2].sort());
    // The closed cycle was current, so the destination took over — its start.
    expect(await f.entry(next, "became_current")).toHaveLength(1);
  });

  it("closing into the backlog records the moved tasks and no carry-in", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.createCycle();
    const open = await f.createTask("Open", { cycleId: f.firstCycleId });

    await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId,
      unfinishedTo: { kind: "backlog" },
    });

    const [closed] = await f.entry(f.firstCycleId, "closed");
    expect(closed.taskIds).toEqual([open]);
    expect(await f.entry(second, "carried_in")).toEqual([]);
  });

  it("deleting a cycle records every task it sent back to the backlog", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.createCycle();
    const a = await f.createTask("A", { cycleId: second });
    const b = await f.createTask("B", { cycleId: second, done: true });

    await f.asUser.mutation(api.cycles.remove, { cycleId: second });

    const [deleted] = await f.entry(second, "deleted");
    expect(deleted.taskIds?.slice().sort()).toEqual([a, b].sort());
  });
});

describe("cycle start", () => {
  it("a new project's first cycle is logged as becoming current, by its creator", async () => {
    const t = createTestContext();
    const f = await setup(t);

    expect(await f.entry(f.firstCycleId, "became_current")).toEqual([
      expect.objectContaining({ actorId: f.userId }),
    ]);
  });

  it("setCurrent logs the switch once, and re-selecting the current cycle logs nothing", async () => {
    const t = createTestContext();
    const f = await setup(t);
    const second = await f.createCycle();

    await f.asUser.mutation(api.cycles.setCurrent, { cycleId: second });
    await f.asUser.mutation(api.cycles.setCurrent, { cycleId: second });

    expect(await f.entry(second, "became_current")).toHaveLength(1);
  });

  it("losing the current cycle with no successor logs no start", async () => {
    const t = createTestContext();
    const f = await setup(t);

    await f.asUser.mutation(api.cycles.close, {
      cycleId: f.firstCycleId,
      unfinishedTo: { kind: "backlog" },
    });

    // Fake timers give every entry the same timestamp, so compare as a set.
    expect((await f.history(f.firstCycleId)).map((e) => e.action).sort()).toEqual([
      "became_current", "closed", "created",
    ]);
  });
});
