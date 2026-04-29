import { expect, describe, it } from "vitest";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { api } from "../../convex/_generated/api";
import { triggers } from "../../convex/dbTriggers";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";

type Ctx = ReturnType<typeof createTestContext>;

async function setupProject(t: Ctx, opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> }) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "P", color: "bg-blue-500",
      workspaceId: opts.workspaceId, creatorId: opts.userId,
      key: "P", taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0,
      isDefault: true, isCompleted: false,
    });
    const doneId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Done", color: "bg-green-500", order: 1,
      isDefault: false, isCompleted: true,
    });
    return { projectId, todoId, doneId };
  });
}

async function listTaskTags(t: Ctx, taskId: Id<"tasks">) {
  return await t.run(async (ctx) =>
    ctx.db.query("taskTags").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect(),
  );
}

async function listEntityTagsForResource(t: Ctx, resourceId: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("entityTags").withIndex("by_resource_id", (q) => q.eq("resourceId", resourceId)).collect(),
  );
}

// ── syncTaskTags via tasks.create / tasks.update ─────────────────────

describe("syncTaskTags via tasks.create / tasks.update", () => {
  it("creates taskTags rows on task create with labels", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug", "frontend"],
    });

    const joins = await listTaskTags(t, taskId);
    expect(joins.map((j) => j.tagName).sort()).toEqual(["bug", "frontend"]);
    expect(joins.every((j) => j.projectId === projectId)).toBe(true);
    expect(joins.every((j) => j.completed === false)).toBe(true);

    // Should NOT have written to entityTags for this task.
    const entityRows = await listEntityTagsForResource(t, taskId);
    expect(entityRows).toHaveLength(0);
  });

  it("normalizes input — trim, lowercase, dedupe", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["  Bug  ", "bug", "FRONTEND", "frontend"],
    });

    const joins = await listTaskTags(t, taskId);
    expect(joins.map((j) => j.tagName).sort()).toEqual(["bug", "frontend"]);
  });

  it("update reconciles taskTags — adds new, removes dropped", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug", "ui"],
    });
    await asUser.mutation(api.tasks.update, { taskId, labels: ["ui", "perf"] });

    const joins = await listTaskTags(t, taskId);
    expect(joins.map((j) => j.tagName).sort()).toEqual(["perf", "ui"]);
  });

  it("re-applying the same labels is idempotent", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug"],
    });
    await asUser.mutation(api.tasks.update, { taskId, labels: ["bug"] });
    await asUser.mutation(api.tasks.update, { taskId, labels: ["bug"] });

    const joins = await listTaskTags(t, taskId);
    expect(joins).toHaveLength(1);
  });
});

// ── completed-sync trigger ───────────────────────────────────────────

describe("taskTags.completed sync trigger", () => {
  it("flips taskTags.completed when the task's status moves to a completed-style status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug"],
    });
    expect((await listTaskTags(t, taskId))[0].completed).toBe(false);

    await asUser.mutation(api.tasks.update, { taskId, statusId: doneId });

    const after = await listTaskTags(t, taskId);
    expect(after[0].completed).toBe(true);
  });
});

// ── uniqueness trigger ───────────────────────────────────────────────

describe("taskTags uniqueness trigger", () => {
  it("rejects a second taskTags row for the same (taskId, tagId)", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug"],
    });
    const joins = await listTaskTags(t, taskId);
    const tagId = joins[0].tagId;

    await expect(
      t.run(async (ctx) => {
        const db = writerWithTriggers(ctx, ctx.db, triggers);
        await db.insert("taskTags", {
          workspaceId, projectId, taskId, tagId,
          tagName: "bug", completed: false,
        });
      }),
    ).rejects.toThrow(/Duplicate taskTag/);
  });
});

// ── cascade on task delete ───────────────────────────────────────────

describe("cascade on task delete", () => {
  it("deletes taskTags rows when a tagged task is removed", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["bug", "frontend"],
    });
    expect(await listTaskTags(t, taskId)).toHaveLength(2);

    await asUser.mutation(api.tasks.remove, { taskId });

    expect(await listTaskTags(t, taskId)).toHaveLength(0);
  });
});

// ── deleteTag walks both join tables ─────────────────────────────────

describe("deleteTag spans entityTags + taskTags", () => {
  it("strips a tag from both a tagged document and a tagged task", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const docId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: docId, tags: ["shared"] });
    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", labels: ["shared"],
    });

    const allTags = await t.run(async (ctx) =>
      ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
    );
    expect(allTags).toHaveLength(1);

    await asUser.mutation(api.tagSync.deleteTag, { tagId: allTags[0]._id });

    // Both denormalized arrays cleared
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(doc?.tags ?? []).toEqual([]);
    expect(task?.labels ?? []).toEqual([]);

    // Both join tables cleared
    expect(await listEntityTagsForResource(t, docId)).toHaveLength(0);
    expect(await listTaskTags(t, taskId)).toHaveLength(0);

    // Dictionary row deleted
    const after = await t.run(async (ctx) =>
      ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
    );
    expect(after).toHaveLength(0);
  });
});

// ── migration ────────────────────────────────────────────────────────

// The @convex-dev/migrations runner is out-of-process, so testing the
// migration here means re-running migrateOne's body inline against a
// crafted pre-migration fixture. Validates the schema/cascade contract,
// not the runner itself.
describe("migrateTaskEntityTagsToTaskTags (logic check)", () => {
  it("moves task entityTags rows to taskTags, leaves non-task rows alone", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    // Pre-migration fixture: a task with a legacy entityTags row.
    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x",
    });
    const tagId = await asUser.mutation(api.tagSync.createTag, {
      workspaceId, name: "legacy",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("entityTags", {
        workspaceId, tagId, tagName: "legacy",
        resourceType: "task", resourceId: taskId,
      });
    });
    // A non-task entityTags row that must remain after migration.
    const docId = await asUser.mutation(api.documents.create, { workspaceId });
    await asUser.mutation(api.documents.updateTags, { id: docId, tags: ["docs"] });

    // Simulate migrateOne over every row.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("entityTags").collect();
      for (const row of rows) {
        if (row.resourceType !== "task") continue;
        const task = await ctx.db.get(row.resourceId as Id<"tasks">);
        if (task) {
          await ctx.db.insert("taskTags", {
            workspaceId: row.workspaceId,
            projectId: task.projectId,
            taskId: task._id,
            tagId: row.tagId,
            tagName: row.tagName,
            completed: task.completed,
          });
        }
        await ctx.db.delete(row._id);
      }
    });

    expect((await listTaskTags(t, taskId)).map((j) => j.tagName)).toEqual(["legacy"]);
    expect((await listEntityTagsForResource(t, docId)).map((r) => r.tagName)).toEqual(["docs"]);
    const afterTaskRows = await t.run(async (ctx) =>
      ctx.db.query("entityTags").withIndex("by_resource_id", (q) => q.eq("resourceId", taskId)).collect(),
    );
    expect(afterTaskRows).toHaveLength(0);
  });
});

describe("backfillTaskTagsAssigneeId (logic check)", () => {
  it("populates assigneeId on existing taskTags rows from the source task", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    // Create a task with an assignee, but insert a legacy taskTags row that
    // predates the assigneeId denormalization (no assigneeId field).
    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x", assigneeId: userId,
    });
    const tagId = await asUser.mutation(api.tagSync.createTag, {
      workspaceId, name: "legacy",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("taskTags", {
        workspaceId, projectId, taskId, tagId,
        tagName: "legacy", completed: false,
        // assigneeId intentionally omitted to model a pre-migration row.
      });
    });

    expect((await listTaskTags(t, taskId))[0].assigneeId).toBeUndefined();

    // Inline run of migrateOne's body — same shape as the migration's logic.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("taskTags").collect();
      for (const row of rows) {
        const task = await ctx.db.get(row.taskId);
        if (!task) continue;
        if (row.assigneeId !== task.assigneeId) {
          await ctx.db.patch(row._id, { assigneeId: task.assigneeId });
        }
      }
    });

    const after = await listTaskTags(t, taskId);
    expect(after[0].assigneeId).toBe(userId);
  });

  it("clears assigneeId when the source task has no assignee", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "x",
    });
    const tagId = await asUser.mutation(api.tagSync.createTag, {
      workspaceId, name: "stale",
    });
    // Stale taskTags row with an assigneeId that no longer matches the task.
    await t.run(async (ctx) => {
      await ctx.db.insert("taskTags", {
        workspaceId, projectId, taskId, tagId,
        tagName: "stale", completed: false,
        assigneeId: userId,
      });
    });

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("taskTags").collect();
      for (const row of rows) {
        const task = await ctx.db.get(row.taskId);
        if (!task) continue;
        if (row.assigneeId !== task.assigneeId) {
          await ctx.db.patch(row._id, { assigneeId: task.assigneeId });
        }
      }
    });

    const after = await listTaskTags(t, taskId);
    expect(after[0].assigneeId).toBeUndefined();
  });
});
