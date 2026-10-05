import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type T = ReturnType<typeof createTestContext>;

async function setupProject(
  t: T,
  { workspaceId, userId }: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "P",
      color: "bg-blue-500",
      workspaceId,
      creatorId: userId,
      key: "TST",
      taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Done", color: "bg-green-500", order: 1, isDefault: false, isCompleted: true,
    });
    return { projectId, todoId, doneId };
  });
}

async function createTasks(
  asUser: Awaited<ReturnType<typeof setupWorkspaceWithAdmin>>["asUser"],
  projectId: Id<"projects">,
  workspaceId: Id<"workspaces">,
  n: number,
  tags?: string[],
) {
  const ids: Id<"tasks">[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      await asUser.mutation(api.tasks.create, { projectId, workspaceId, title: `Task ${i}`, tags }),
    );
  }
  return ids;
}

const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

describe("taskBulk.apply", () => {
  it("deletes every selected task across several batches, with their subtrees", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });
    // More than one batch's worth.
    const ids = await createTasks(asUser, projectId, workspaceId, 23);
    const keep = ids.pop()!;
    const commentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", { taskId: ids[0], userId, body: "hi", deleted: false }),
    );

    await asUser.mutation(api.taskBulk.apply, {
      projectId,
      taskIds: ids,
      op: { kind: "delete", closeGithubIssues: false },
    });
    await drain(t);

    await t.run(async (ctx) => {
      for (const id of ids) expect(await ctx.db.get(id)).toBeNull();
      expect(await ctx.db.get(commentId)).toBeNull();
      expect(await ctx.db.get(keep)).not.toBeNull();
    });
  });

  it("skips ids that belong to another project", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const a = await setupProject(t, { workspaceId, userId });
    const b = await setupProject(t, { workspaceId, userId });
    const [foreign] = await createTasks(asUser, b.projectId, workspaceId, 1);

    await asUser.mutation(api.taskBulk.apply, {
      projectId: a.projectId,
      taskIds: [foreign],
      op: { kind: "delete", closeGithubIssues: false },
    });
    await drain(t);

    expect(await t.run((ctx) => ctx.db.get(foreign))).not.toBeNull();
  });

  it("moves tasks to a status and applies the completed side effect", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });
    const ids = await createTasks(asUser, projectId, workspaceId, 3);

    await asUser.mutation(api.taskBulk.apply, {
      projectId,
      taskIds: ids,
      op: { kind: "status", statusId: doneId },
    });
    await drain(t);

    await t.run(async (ctx) => {
      for (const id of ids) {
        const task = await ctx.db.get(id);
        expect(task?.statusId).toBe(doneId);
        expect(task?.completed).toBe(true);
      }
    });
  });

  it("sets priority and assignee", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });
    const ids = await createTasks(asUser, projectId, workspaceId, 2);

    await asUser.mutation(api.taskBulk.apply, { projectId, taskIds: ids, op: { kind: "priority", priority: "urgent" } });
    await asUser.mutation(api.taskBulk.apply, { projectId, taskIds: ids, op: { kind: "assignee", assigneeId: userId } });
    await drain(t);

    await t.run(async (ctx) => {
      for (const id of ids) {
        const task = await ctx.db.get(id);
        expect(task?.priority).toBe("urgent");
        expect(task?.assigneeId).toBe(userId);
      }
    });
  });

  it("adds and removes a tag, keeping taskTags in sync", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });
    const [plain] = await createTasks(asUser, projectId, workspaceId, 1);
    const [tagged] = await createTasks(asUser, projectId, workspaceId, 1, ["bug", "ui"]);

    await asUser.mutation(api.taskBulk.apply, {
      projectId,
      taskIds: [plain, tagged],
      op: { kind: "addTag", tag: "  Bug " },
    });
    await drain(t);

    await t.run(async (ctx) => {
      expect((await ctx.db.get(plain))?.tags).toEqual(["bug"]);
      expect((await ctx.db.get(tagged))?.tags).toEqual(["bug", "ui"]);
    });

    await asUser.mutation(api.taskBulk.apply, {
      projectId,
      taskIds: [plain, tagged],
      op: { kind: "removeTag", tag: "bug" },
    });
    await drain(t);

    await t.run(async (ctx) => {
      expect((await ctx.db.get(plain))?.tags ?? []).toEqual([]);
      expect((await ctx.db.get(tagged))?.tags).toEqual(["ui"]);
      const joins = await ctx.db
        .query("taskTags")
        .withIndex("by_task", (q) => q.eq("taskId", tagged))
        .collect();
      expect(joins.map((j) => j.tagName).sort()).toEqual(["ui"]);
    });
  });

  it("converges when a batch is replayed (retry restarts the drain)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });
    const ids = await createTasks(asUser, projectId, workspaceId, 2, ["ui"]);

    const args = { userId, projectId, taskIds: ids, op: { kind: "addTag" as const, tag: "bug" } };
    expect(await t.mutation(internal.taskBulk.applyBatch, args)).toBe(true);
    expect(await t.mutation(internal.taskBulk.applyBatch, args)).toBe(true);

    const del = { userId, projectId, taskIds: ids, op: { kind: "delete" as const, closeGithubIssues: false } };
    await t.mutation(internal.taskBulk.applyBatch, del);
    await t.mutation(internal.taskBulk.applyBatch, del);
    await drain(t);

    await t.run(async (ctx) => {
      for (const id of ids) expect(await ctx.db.get(id)).toBeNull();
    });
  });

  it("abandons the drain when the user has lost access", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });
    const ids = await createTasks(asUser, projectId, workspaceId, 1);
    const { userId: outsider } = await setupAuthenticatedUser(t, { email: "o@example.com" });

    const ok = await t.mutation(internal.taskBulk.applyBatch, {
      userId: outsider,
      projectId,
      taskIds: ids,
      op: { kind: "delete", closeGithubIssues: false },
    });
    expect(ok).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(ids[0]))).not.toBeNull();
  });

  it("rejects non-members, foreign statuses, foreign assignees and oversized selections", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const a = await setupProject(t, { workspaceId, userId });
    const b = await setupProject(t, { workspaceId, userId });
    const ids = await createTasks(asUser, a.projectId, workspaceId, 1);
    const { userId: outsiderId, asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "o@example.com",
    });

    await expect(
      outsider.mutation(api.taskBulk.apply, {
        projectId: a.projectId, taskIds: ids, op: { kind: "delete", closeGithubIssues: false },
      }),
    ).rejects.toThrow();
    await expect(
      asUser.mutation(api.taskBulk.apply, {
        projectId: a.projectId, taskIds: ids, op: { kind: "status", statusId: b.doneId },
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      asUser.mutation(api.taskBulk.apply, {
        projectId: a.projectId, taskIds: ids, op: { kind: "assignee", assigneeId: outsiderId },
      }),
    ).rejects.toThrow(/not a member/);
    await expect(
      asUser.mutation(api.taskBulk.apply, {
        projectId: a.projectId,
        taskIds: Array.from({ length: 501 }, (_, i) => `${ids[0]}${i}` as Id<"tasks">),
        op: { kind: "priority", priority: "low" },
      }),
    ).rejects.toThrow();
  });
});
