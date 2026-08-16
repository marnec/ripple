import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * `hasBlockers` is computed at five separate call sites — `tasks.get`,
 * `tasks.listByProject` (via `enrichTasks`),
 * `cycles.listCycleTasks` and `taskImports.listJobTasks`. Every one of them
 * had the same hand-rolled scan and none of them had a test. This file is the
 * net: the discriminating case is an inbound edge that is NOT a blocker, since
 * that is what any "does an inbound edge exist" shortcut would get wrong.
 */
async function setupBlockerFixture(t: ReturnType<typeof createTestContext>) {
  const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

  const { projectId, todoId } = await t.run(async (ctx) => {
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
    return { projectId, todoId };
  });

  const blocked = await asUser.mutation(api.tasks.create, {
    projectId,
    workspaceId,
    title: "Blocked task",
    statusId: todoId,
  });
  const mentioned = await asUser.mutation(api.tasks.create, {
    projectId,
    workspaceId,
    title: "Merely mentioned task",
    statusId: todoId,
  });
  const other = await asUser.mutation(api.tasks.create, {
    projectId,
    workspaceId,
    title: "Other task",
    statusId: todoId,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: other,
      targetType: "task",
      targetId: blocked,
      edgeType: "blocks",
      workspaceId,
      createdAt: 0,
    });
    // Inbound, but not a blocker. A chatty task accumulates thousands of
    // these — one per message that references it.
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: other,
      targetType: "task",
      targetId: mentioned,
      edgeType: "mentions",
      workspaceId,
      createdAt: 0,
    });
  });

  return { workspaceId, userId, asUser, projectId, todoId, blocked, mentioned, other };
}

function blockerFlags(tasks: { _id: Id<"tasks">; hasBlockers: boolean }[]) {
  return new Map(tasks.map((t) => [t._id, t.hasBlockers]));
}

describe("hasBlockers", () => {
  it("tasks.get reports a blocker only for the blocked task", async () => {
    const t = createTestContext();
    const { asUser, blocked, mentioned } = await setupBlockerFixture(t);

    const blockedTask = await asUser.query(api.tasks.get, { taskId: blocked });
    const mentionedTask = await asUser.query(api.tasks.get, { taskId: mentioned });

    expect(blockedTask?.hasBlockers).toBe(true);
    expect(mentionedTask?.hasBlockers).toBe(false);
  });

  it("tasks.listByProject reports a blocker only for the blocked task", async () => {
    const t = createTestContext();
    const { asUser, projectId, blocked, mentioned } = await setupBlockerFixture(t);

    const page = await asUser.query(api.tasks.listByProject, {
      projectId,
      completed: false,
    });
    const flags = blockerFlags(page);

    expect(flags.get(blocked)).toBe(true);
    expect(flags.get(mentioned)).toBe(false);
  });

  it("cycles.listCycleTasks reports a blocker only for the blocked task", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId, blocked, mentioned } =
      await setupBlockerFixture(t);

    const cycleId = await t.run(async (ctx) => {
      const cycleId = await ctx.db.insert("cycles", {
        projectId,
        workspaceId,
        name: "Cycle 1",
        status: "active",
        creatorId: userId,
      });
      for (const taskId of [blocked, mentioned]) {
        await ctx.db.insert("cycleTasks", { cycleId, taskId, projectId, addedBy: userId });
      }
      return cycleId;
    });

    const flags = blockerFlags(await asUser.query(api.cycles.listCycleTasks, { cycleId }));

    expect(flags.get(blocked)).toBe(true);
    expect(flags.get(mentioned)).toBe(false);
  });

  it("taskImports.listJobTasks reports a blocker only for the blocked task", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId, blocked, mentioned } =
      await setupBlockerFixture(t);

    const jobId = await t.run(async (ctx) => {
      const jobId = await ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "completed",
        rows: [],
        numberRangeStart: 1,
        totalRows: 2,
        processedRows: 2,
        failedRows: 0,
      });
      for (const taskId of [blocked, mentioned]) {
        await ctx.db.patch(taskId, { importJobId: jobId });
      }
      return jobId;
    });

    const flags = blockerFlags(await asUser.query(api.taskImports.listJobTasks, { jobId }));

    expect(flags.get(blocked)).toBe(true);
    expect(flags.get(mentioned)).toBe(false);
  });
});

/**
 * `tasks.create` and the CSV importer both append to the end of a status
 * column. Both used to collect the whole column and JS-reduce for the maximum
 * `position`, when `position` is the third key of
 * `by_project_status_position` — so `.order("desc").first()` answers it in one
 * row. The discriminating case is a column that mixes positioned rows with
 * legacy rows whose `position` is undefined: those sort before every string,
 * so the maximum must still be the highest string.
 */
describe("append position", () => {
  it("places a new task after the highest existing position in its column", async () => {
    const t = createTestContext();
    const { asUser, workspaceId, projectId, todoId } = await setupBlockerFixture(t);

    // A legacy row with no position at all, alongside positioned rows.
    await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project_completed", (q) =>
          q.eq("projectId", projectId).eq("completed", false),
        )
        .collect();
      await ctx.db.patch(tasks[0]._id, { position: undefined });
      await ctx.db.patch(tasks[1]._id, { position: "a0" });
      await ctx.db.patch(tasks[2]._id, { position: "a1" });
    });

    const appendedId = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Appended",
      statusId: todoId,
    });

    const appended = await t.run(async (ctx) => ctx.db.get(appendedId));
    expect(appended?.position).toBeDefined();
    expect(appended!.position! > "a1").toBe(true);
  });
});

/**
 * `listByAssignee` is workspace-scoped, but `by_assignee_completed` has no
 * workspace column — so it used to read the caller's assigned tasks in every
 * workspace and drop the foreign ones in JS. A consultant in six workspaces
 * paid a cross-workspace reactive dependency for a single workspace's view.
 */
describe("listByAssignee — workspace scope", () => {
  it("returns only the caller's tasks in the requested workspace", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId, todoId } =
      await setupBlockerFixture(t);

    const mineHere = await asUser.mutation(api.tasks.create, {
      projectId,
      workspaceId,
      title: "Mine here",
      statusId: todoId,
      assigneeId: userId,
    });

    // A second workspace the same user belongs to, with a task assigned to them.
    const other = await t.run(async (ctx) => {
      const ws = await ctx.db.insert("workspaces", { name: "Other", ownerId: userId });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: ws,
        userId,
        role: "admin",
      });
      const proj = await ctx.db.insert("projects", {
        name: "Other project",
        color: "bg-red-500",
        workspaceId: ws,
        creatorId: userId,
        key: "OTH",
      });
      const status = await ctx.db.insert("taskStatuses", {
        projectId: proj,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      });
      return { ws, proj, status };
    });
    await asUser.mutation(api.tasks.create, {
      projectId: other.proj,
      workspaceId: other.ws,
      title: "Mine elsewhere",
      statusId: other.status,
      assigneeId: userId,
    });

    const result = await asUser.query(api.tasks.listByAssignee, {
      workspaceId,
      completed: false,
    });

    expect(result.map((task) => task._id)).toEqual([mineHere]);
    expect(result[0]?.projectKey).toBe("TST");
  });
});
