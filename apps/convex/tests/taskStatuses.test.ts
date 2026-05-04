import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setupProject(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  const { workspaceId, userId } = opts;
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "P",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "P",
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
    const inProgressId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
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

async function insertTask(
  t: ReturnType<typeof createTestContext>,
  opts: {
    projectId: Id<"projects">;
    workspaceId: Id<"workspaces">;
    statusId: Id<"taskStatuses">;
    creatorId: Id<"users">;
    completed: boolean;
    title: string;
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("tasks", {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      title: opts.title,
      statusId: opts.statusId,
      priority: "medium",
      completed: opts.completed,
      creatorId: opts.creatorId,
    })
  );
}

describe("taskStatuses.remove", () => {
  it("rejects deleting the default status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { todoId, inProgressId } = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.remove, {
        statusId: todoId,
        reassignToStatusId: inProgressId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects when reassign target is the status being deleted", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { doneId } = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.remove, {
        statusId: doneId,
        reassignToStatusId: doneId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects when reassign target belongs to a different project", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const a = await setupProject(t, { workspaceId, userId });
    const b = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.remove, {
        statusId: a.doneId,
        reassignToStatusId: b.todoId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("hides the column immediately and reassigns tasks (preserving completed) via the workpool", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId, inProgressId, doneId } = await setupProject(t, {
      workspaceId,
      userId,
    });

    const completedTaskId = await insertTask(t, {
      projectId,
      workspaceId,
      statusId: doneId,
      creatorId: userId,
      completed: true,
      title: "shipped",
    });
    const otherDoneTaskId = await insertTask(t, {
      projectId,
      workspaceId,
      statusId: doneId,
      creatorId: userId,
      completed: true,
      title: "shipped 2",
    });

    await asUser.mutation(api.taskStatuses.remove, {
      statusId: doneId,
      reassignToStatusId: inProgressId,
    });

    // Column hidden from listByProject right away (before action drains).
    const visibleBefore = await asUser.query(api.taskStatuses.listByProject, {
      projectId,
    });
    expect(visibleBefore.map((s) => s._id)).toEqual([todoId, inProgressId]);

    // Drive the scheduled workpool action to completion.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const completedTask = await t.run(async (ctx) => ctx.db.get(completedTaskId));
    const otherDone = await t.run(async (ctx) => ctx.db.get(otherDoneTaskId));
    expect(completedTask?.statusId).toBe(inProgressId);
    expect(completedTask?.completed).toBe(true);
    expect(otherDone?.statusId).toBe(inProgressId);
    expect(otherDone?.completed).toBe(true);

    const stillExists = await t.run(async (ctx) => ctx.db.get(doneId));
    expect(stillExists).toBeNull();
  });

  it("rejects a second delete while one is in progress", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { todoId, doneId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.taskStatuses.remove, {
      statusId: doneId,
      reassignToStatusId: todoId,
    });

    await expect(
      asUser.mutation(api.taskStatuses.remove, {
        statusId: doneId,
        reassignToStatusId: todoId,
      }),
    ).rejects.toThrow(ConvexError);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
