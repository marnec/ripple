import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createTestContext, setupWorkspaceWithAdmin } from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * The CSV payload lives inline on the job row, so every mutation that opens
 * with `ctx.db.get(jobId)` reads the whole blob and every patch of the job
 * rewrites it. One mutation per row therefore moved O(rows x payload) bytes in
 * each direction to create O(rows) small tasks. `createImportedTasks` applies a
 * slice per call, reading the job once and patching it once for the batch.
 *
 * These tests pin the behaviour that batching must not change — a row that
 * fails validation still costs only itself, task numbers still track the row
 * index, and positions still come out in row order — plus the batch shape
 * itself, which is what keeps the cost down.
 */

const IMPORT_BATCH_SIZE = 50;

async function setupProjectWithStatuses(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Import Project",
      color: "bg-blue-500",
      workspaceId: opts.workspaceId,
      creatorId: opts.userId,
      key: "IMP",
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
}

/** CSV-shaped row, as the client sends it to `createImportJob`. */
const validRow = (title: string, overrides: Record<string, string> = {}) => ({
  title,
  priority: "medium",
  tags: "",
  dueDate: "",
  plannedStartDate: "",
  estimate: "",
  ...overrides,
});

/**
 * Parsed-output shape, as `createImportJob` stores it. Tests that seed a job
 * row directly must use this: the batch re-checks each row against the OUTPUT
 * schema, which rejects the empty strings the input schema coerces away.
 */
const storedRow = (title: string) => ({
  title,
  priority: "medium" as const,
  tags: null,
  dueDate: null,
  plannedStartDate: null,
  estimate: null,
});

async function importedTasks(
  t: ReturnType<typeof createTestContext>,
  jobId: Id<"taskImportJobs">,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("tasks")
      .withIndex("by_importJob", (q) => q.eq("importJobId", jobId))
      .collect(),
  );
}

describe("taskImports batching", () => {
  it("imports a job that spans several batches, in row order", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    // Deliberately not a multiple of the batch size, so the short final batch
    // is exercised too.
    const total = IMPORT_BATCH_SIZE * 2 + 7;
    const rows = Array.from({ length: total }, (_, i) =>
      validRow(`Row ${String(i).padStart(3, "0")}`),
    );

    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "completed",
      totalRows: total,
      processedRows: total,
      failedRows: 0,
    });

    const tasks = await importedTasks(t, jobId);
    expect(tasks).toHaveLength(total);

    // Numbers come from the pre-reserved range and must track the row index,
    // which is what makes them contiguous across batch boundaries.
    expect([...tasks].map((task) => task.number).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: total }, (_, i) => i + 1),
    );

    // Position is generated per row and chained forward within a batch rather
    // than re-read from the column tail. Distinctness is the assertion that
    // bites: reading the tail once and NOT chaining hands every row in the
    // batch the same key, which still happens to come out in insertion order
    // below, so ordering alone would not notice.
    expect(new Set(tasks.map((task) => task.position)).size).toBe(total);

    const byPosition = [...tasks].sort((a, b) =>
      (a.position ?? "") < (b.position ?? "") ? -1 : 1,
    );
    expect(byPosition.map((task) => task.title)).toEqual(
      rows.map((row) => row.title),
    );
  });

  it("charges a bad row to itself, not to the rest of its batch", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    // Seeded directly: the rotten row has to get past createImportJob's zod
    // pass to reach the batch, and the point is what happens to its neighbours.
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: [
          storedRow("Before"),
          { priority: null, tags: null }, // no title — fails the row schema
          storedRow("After"),
        ],
        numberRangeStart: 1,
        totalRows: 3,
        processedRows: 0,
        failedRows: 0,
      }),
    );

    await t.action(internal.taskImports.runImport, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "completed",
      processedRows: 3,
      failedRows: 1,
    });

    const tasks = await importedTasks(t, jobId);
    expect(tasks.map((task) => task.title).sort()).toEqual(["After", "Before"]);
    // The failed row still consumes its reserved number, so the survivors keep
    // the numbers their row index earned.
    expect(
      Object.fromEntries(tasks.map((task) => [task.title, task.number])),
    ).toEqual({ Before: 1, After: 3 });
  });

  it("applies a whole slice per call and books its progress once", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, { workspaceId, userId });

    const rows = Array.from({ length: 6 }, (_, i) => validRow(`Row ${i}`));
    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows,
    });

    // Drive one batch directly rather than through the action: this is the
    // shape assertion. Four rows in, one mutation — so one job read carrying
    // the payload and one job patch rewriting it, not four of each.
    await t.mutation(internal.taskImports.createImportedTasks, {
      jobId,
      startIndex: 1,
      count: 4,
    });

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      processedRows: 4,
      failedRows: 0,
    });
    const tasks = await importedTasks(t, jobId);
    expect(tasks.map((task) => task.title).sort()).toEqual([
      "Row 1",
      "Row 2",
      "Row 3",
      "Row 4",
    ]);
  });

  it("books an entire batch as failed when its mutation cannot commit", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    // A project with no default status makes createImportedTasks throw, which
    // is the batch-level failure path: nothing is written and the action has to
    // account for every row it handed over.
    const projectId = await t.run(async (ctx) =>
      ctx.db.insert("projects", {
        name: "Statusless",
        color: "bg-blue-500",
        workspaceId,
        creatorId: userId,
        key: "NST",
        taskCounter: 0,
      }),
    );

    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: [storedRow("A"), storedRow("B")],
        numberRangeStart: 1,
        totalRows: 2,
        processedRows: 0,
        failedRows: 0,
      }),
    );

    await t.action(internal.taskImports.runImport, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run(async (ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "failed",
      processedRows: 2,
      failedRows: 2,
    });
    expect(await importedTasks(t, jobId)).toHaveLength(0);
  });
});
