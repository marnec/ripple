/**
 * The denormalization triggers in `dbTriggers.ts` only fire for writes routed
 * through a trigger-aware writer. Historically each mutation re-derived that
 * writer itself (`writerWithTriggers(ctx, ctx.db, triggers)`), which made
 * "remember to wrap" a convention — and a convention that several write paths
 * forgot, silently leaving denormalized columns stale.
 *
 * These tests pin the behaviour the convention was supposed to guarantee, for
 * the paths that used to bypass it, plus a structural guard so a new mutation
 * cannot reintroduce the bypass.
 */
import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { api } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

// Bulk tag/status rewrites drain on the scheduler; matches taskStatuses.test.ts.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

// ── tasks.updatePosition (kanban drag) ───────────────────────────────
// `updatePosition` writes `completed` alongside the status move. That is the
// exact column `taskTags.by_project_tag_completed` partitions on, so a stale
// join row makes a tag-filtered board silently drop or duplicate the task.

describe("tasks.updatePosition maintains denormalized columns", () => {
  it("flips taskTags.completed on a kanban drag into a completed status", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "drag me", labels: ["bug"],
    });
    expect((await listTaskTags(t, taskId))[0].completed).toBe(false);

    await asUser.mutation(api.tasks.updatePosition, {
      taskId, statusId: doneId, position: "a1",
    });

    expect((await listTaskTags(t, taskId))[0].completed).toBe(true);
  });

  it("keeps the tag-filtered completed query in agreement with the task row", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, doneId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "drag me", labels: ["bug"],
    });
    await asUser.mutation(api.tasks.updatePosition, {
      taskId, statusId: doneId, position: "a1",
    });

    // The tag-driven read path scans `taskTags`, not `tasks`.
    const completed = await asUser.query(api.tasks.listByProject, {
      projectId, completed: true, tagNames: ["bug"],
    });
    expect(completed.map((task) => task._id)).toEqual([taskId]);

    const open = await asUser.query(api.tasks.listByProject, {
      projectId, completed: false, tagNames: ["bug"],
    });
    expect(open).toHaveLength(0);
  });
});

// ── taskStatuses.update (isCompleted toggle) ─────────────────────────
// Toggling `isCompleted` on a status bulk-patches every task in that column.

describe("taskStatuses.update maintains denormalized columns", () => {
  it("flips taskTags.completed for every task in a status marked completed", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    const taskId = await asUser.mutation(api.tasks.create, {
      projectId, workspaceId, title: "in todo", labels: ["bug"],
    });
    expect((await listTaskTags(t, taskId))[0].completed).toBe(false);

    await asUser.mutation(api.taskStatuses.update, { statusId: todoId, isCompleted: true });
    // The column flip is batched behind the mutation; drain it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await listTaskTags(t, taskId))[0].completed).toBe(true);
  });
});

// ── Structural guard ─────────────────────────────────────────────────
// The three bugs above were all the same bug: a mutation handed the raw
// `ctx.db`. `convex/functions.ts` is the single place that builds the
// trigger-aware mutation builders, so it is the only module allowed to reach
// for the raw ones. `apps/convex`'s lint step is `tsc` only, so this guard
// lives in the test suite.

const CONVEX_DIR = join(__dirname, "..", "convex");

/**
 * Modules allowed to build on the raw `mutation` / `internalMutation`.
 *
 * - `functions.ts` is where the wrapping happens.
 * - `migrations.ts` is the repair path for exactly the state the triggers
 *   maintain: `backfillDocumentAggregates` and friends call the aggregate's
 *   `insertIfDoesNotExist` themselves, and `backfill*Nodes` writes `nodes` rows
 *   by hand. Running those through the triggers would have the backfill fighting
 *   the thing it exists to repair, so migrations stay on the raw builder.
 */
const RAW_BUILDER_ALLOWLIST = ["functions.ts", "migrations.ts"];

/**
 * Modules allowed to apply the wrapper by hand.
 *
 * - `dbTriggers.ts` defines it.
 * - `auth.ts`'s `createOrUpdateUser` is a Convex Auth callback, not one of our
 *   mutations, so it never passes through `functions.ts` and has to wrap itself.
 */
const WRAP_ALLOWLIST = ["functions.ts", "dbTriggers.ts", "auth.ts"];

function convexSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "_generated" ? [] : convexSourceFiles(full);
    }
    return entry.endsWith(".ts") ? [full] : [];
  });
}

describe("bypassing the trigger-aware writer is not representable", () => {
  it("only convex/functions.ts imports the raw mutation builders", () => {
    const offenders = convexSourceFiles(CONVEX_DIR).filter((file) => {
      const rel = relative(CONVEX_DIR, file);
      if (RAW_BUILDER_ALLOWLIST.includes(rel)) return false;
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"[^"]*_generated\/server(?:\.js)?"/g,
      )) {
        const names = match[1].split(",").map((n) => n.trim());
        if (names.some((n) => n === "mutation" || n === "internalMutation")) return true;
      }
      return false;
    });

    expect(offenders.map((f) => relative(CONVEX_DIR, f))).toEqual([]);
  });

  it("no module re-derives a trigger writer on top of the wrapped ctx", () => {
    const offenders = convexSourceFiles(CONVEX_DIR).filter((file) => {
      const rel = relative(CONVEX_DIR, file);
      if (WRAP_ALLOWLIST.includes(rel)) return false;
      const src = readFileSync(file, "utf8");
      // Double-wrapping is not merely redundant: both layers grab the module-level
      // `outerWriteLock` in convex-helpers, so the second write deadlocks.
      return /writerWithTriggers\(\s*ctx\s*,\s*ctx\.db/.test(src) || /\bwithTriggers\(\s*ctx\s*\)/.test(src);
    });

    expect(offenders.map((f) => relative(CONVEX_DIR, f))).toEqual([]);
  });
});
