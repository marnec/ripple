import { expect, describe, it } from "vitest";
import { v } from "convex/values";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * `tasks.labels` is gone from schema.ts — that is the point of the migration —
 * but convex-test validates writes, so the legacy row this migration exists to
 * repair cannot be seeded against the real schema. Clone the schema and put the
 * column back for the duration of these tests.
 *
 * The clone copies the TableDefinition's own properties (`indexes`,
 * `searchIndexes`, `validator`, …) and keeps its prototype, so `by_task` and
 * every other index the migration queries through still resolve.
 */
function schemaWithLegacyTaskLabels(): typeof schema {
  const tables = (schema as unknown as { tables: Record<string, any> }).tables;
  const tasks = tables.tasks;
  const widenedTasks = Object.assign(
    Object.create(Object.getPrototypeOf(tasks)),
    tasks,
    { validator: v.object({ ...tasks.validator.fields, labels: v.optional(v.array(v.string())) }) },
  );
  return Object.assign(Object.create(Object.getPrototypeOf(schema)), schema, {
    tables: { ...tables, tasks: widenedTasks },
  }) as typeof schema;
}

type Ctx = ReturnType<typeof createTestContext>;

async function seedTask(
  t: Ctx,
  opts: {
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    projectId: Id<"projects">;
    statusId: Id<"taskStatuses">;
    completed?: boolean;
    labels?: string[];
    tags?: string[];
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("tasks", {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      title: "T",
      statusId: opts.statusId,
      priority: "high",
      completed: opts.completed ?? false,
      creatorId: opts.userId,
      ...(opts.labels ? { labels: opts.labels } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
    } as never),
  );
}

async function setupProject(t: Ctx, workspaceId: Id<"workspaces">, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "P", color: "bg-blue-500", workspaceId, creatorId: userId,
      key: "P", taskCounter: 0,
    });
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId, name: "Todo", color: "bg-gray-500", order: 0,
      isDefault: true, isCompleted: false,
    });
    return { projectId, statusId };
  });
}

async function runMigration(t: Ctx) {
  await t.mutation(internal.migrations.run, { fn: "migrations:migrateTaskLabelsToTags" });
  await t.finishAllScheduledFunctions(() => {});
}

const readTask = (t: Ctx, taskId: Id<"tasks">) =>
  t.run(async (ctx) => (await ctx.db.get(taskId)) as unknown as Record<string, unknown>);

const readJoins = (t: Ctx, taskId: Id<"tasks">) =>
  t.run(async (ctx) =>
    ctx.db.query("taskTags").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect(),
  );

describe("migrateTaskLabelsToTags", () => {
  it("moves labels to tags, normalizing and deduping, and drops the old column", async () => {
    const t = createTestContext(schemaWithLegacyTaskLabels());
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, statusId } = await setupProject(t, workspaceId, userId);
    const taskId = await seedTask(t, {
      workspaceId, userId, projectId, statusId,
      labels: ["Alpha", "  alpha  ", "Beta", ""],
    });

    await runMigration(t);

    const task = await readTask(t, taskId);
    expect(task.tags).toEqual(["alpha", "beta"]);
    expect(task.labels).toBeUndefined();
  });

  // The regression this file exists for: moving the column is only half the
  // job. `tasks.tags` is a denormalized projection — the tag-filtered board
  // queries partition on the `taskTags` join, and the migrations component
  // writes through the raw db, so no trigger backfills it. A task migrated
  // without joins keeps its tags on the card and vanishes from every board.
  it("backfills the tags dictionary and the taskTags join", async () => {
    const t = createTestContext(schemaWithLegacyTaskLabels());
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, statusId } = await setupProject(t, workspaceId, userId);
    const taskId = await seedTask(t, {
      workspaceId, userId, projectId, statusId,
      completed: true,
      labels: ["Alpha", "Beta"],
    });

    await runMigration(t);

    const joins = await readJoins(t, taskId);
    expect(joins.map((j) => j.tagName).sort()).toEqual(["alpha", "beta"]);
    // `completed` is denormalized onto the join so the primary access pattern
    // stays a single indexed range scan.
    expect(joins.every((j) => j.completed === true)).toBe(true);
    expect(joins.every((j) => j.projectId === projectId)).toBe(true);

    const dict = await t.run(async (ctx) =>
      ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
    );
    expect(dict.map((d) => d.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("reuses an existing dictionary row instead of inserting a duplicate", async () => {
    const t = createTestContext(schemaWithLegacyTaskLabels());
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, statusId } = await setupProject(t, workspaceId, userId);
    const existingTagId = await t.run(async (ctx) =>
      ctx.db.insert("tags", { workspaceId, name: "alpha" }),
    );
    const taskId = await seedTask(t, {
      workspaceId, userId, projectId, statusId, labels: ["Alpha"],
    });

    await runMigration(t);

    const joins = await readJoins(t, taskId);
    expect(joins).toHaveLength(1);
    expect(joins[0].tagId).toEqual(existingTagId);
    const dict = await t.run(async (ctx) =>
      ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
    );
    expect(dict).toHaveLength(1);
  });

  it("is idempotent — runAll executes it on every deploy", async () => {
    const t = createTestContext(schemaWithLegacyTaskLabels());
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, statusId } = await setupProject(t, workspaceId, userId);
    const taskId = await seedTask(t, {
      workspaceId, userId, projectId, statusId, labels: ["Alpha"],
    });

    await runMigration(t);
    await t.mutation(internal.migrations.run, {
      fn: "migrations:migrateTaskLabelsToTags",
      cursor: null,
    });
    await t.finishAllScheduledFunctions(() => {});

    expect(await readJoins(t, taskId)).toHaveLength(1);
    expect((await readTask(t, taskId)).tags).toEqual(["alpha"]);
  });

  it("leaves a task that never had labels alone", async () => {
    const t = createTestContext(schemaWithLegacyTaskLabels());
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, statusId } = await setupProject(t, workspaceId, userId);
    const taskId = await seedTask(t, {
      workspaceId, userId, projectId, statusId, tags: ["kept"],
    });

    await runMigration(t);

    expect((await readTask(t, taskId)).tags).toEqual(["kept"]);
    // No labels column means nothing to reconcile — the join stays the
    // business of the normal write path, not this repair path.
    expect(await readJoins(t, taskId)).toHaveLength(0);
  });
});
