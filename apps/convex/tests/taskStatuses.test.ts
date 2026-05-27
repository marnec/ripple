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

describe("taskStatuses.update — externalCloseReason", () => {
  it("admin can set a completed status's externalCloseReason to 'not_planned'", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { doneId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.taskStatuses.update, {
      statusId: doneId,
      externalCloseReason: "not_planned",
    });

    const status = await t.run((ctx) => ctx.db.get(doneId));
    expect(status?.externalCloseReason).toBe("not_planned");
  });

  it("passing externalCloseReason=null clears it (admin can revert to default)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { doneId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.taskStatuses.update, {
      statusId: doneId,
      externalCloseReason: "not_planned",
    });
    await asUser.mutation(api.taskStatuses.update, {
      statusId: doneId,
      externalCloseReason: null,
    });

    const status = await t.run((ctx) => ctx.db.get(doneId));
    expect(status?.externalCloseReason).toBeUndefined();
  });
});

describe("taskStatuses.setSingletonEffect", () => {
  it("assigning default moves it off the previous holder", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { todoId, inProgressId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.taskStatuses.setSingletonEffect, {
      statusId: inProgressId,
      effect: "default",
      value: true,
    });

    const [todo, inProgress] = await t.run(async (ctx) => [
      await ctx.db.get(todoId),
      await ctx.db.get(inProgressId),
    ]);
    expect(todo?.isDefault).toBe(false);
    expect(inProgress?.isDefault).toBe(true);
  });

  it("rejects clearing the default (a project must always have one)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { todoId } = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.setSingletonEffect, {
        statusId: todoId,
        effect: "default",
        value: false,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("assigning triage is exclusive and clears the previous triage status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { inProgressId, todoId } = await setupProject(t, { workspaceId, userId });

    // todo is the default, so use inProgress for triage first, then move it.
    await asUser.mutation(api.taskStatuses.setSingletonEffect, {
      statusId: inProgressId,
      effect: "triage",
      value: true,
    });
    // Create a fresh non-default, non-completed status to receive triage next.
    const reviewId = await asUser.mutation(api.taskStatuses.create, {
      projectId: (await t.run((ctx) => ctx.db.get(todoId)))!.projectId,
      name: "Review",
      color: "bg-purple-500",
      isCompleted: false,
    });
    await asUser.mutation(api.taskStatuses.setSingletonEffect, {
      statusId: reviewId,
      effect: "triage",
      value: true,
    });

    const [inProgress, review] = await t.run(async (ctx) => [
      await ctx.db.get(inProgressId),
      await ctx.db.get(reviewId),
    ]);
    expect(inProgress?.isTriage).toBe(false);
    expect(review?.isTriage).toBe(true);
  });

  it("rejects triage on the default status (mutually exclusive)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { todoId } = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.setSingletonEffect, {
        statusId: todoId, // todo is the default
        effect: "triage",
        value: true,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects triage on a completed status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { doneId } = await setupProject(t, { workspaceId, userId });

    await expect(
      asUser.mutation(api.taskStatuses.setSingletonEffect, {
        statusId: doneId,
        effect: "triage",
        value: true,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("update rejects marking a triage status completed", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { inProgressId } = await setupProject(t, { workspaceId, userId });

    await asUser.mutation(api.taskStatuses.setSingletonEffect, {
      statusId: inProgressId,
      effect: "triage",
      value: true,
    });
    await expect(
      asUser.mutation(api.taskStatuses.update, {
        statusId: inProgressId,
        isCompleted: true,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
