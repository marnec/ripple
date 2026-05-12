import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
  setupAuthenticatedUser,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

// Mirror tasks.test.ts: convex-test's scheduler runs scheduled jobs against
// fake timers, so the workpool / audit log effects don't bleed across tests.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Create a project + the three default statuses (matches projects.create). */
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
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 1,
      isDefault: false,
      isCompleted: true,
    });
    return { projectId, todoId };
  });
}

const validRow = (title: string, overrides: Record<string, string> = {}) => ({
  title,
  priority: "medium",
  tags: "",
  dueDate: "",
  plannedStartDate: "",
  estimate: "",
  ...overrides,
});

describe("taskImports.createImportJob", () => {
  it("creates a queued job and reserves a contiguous number range", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const rows = [
      validRow("A"),
      validRow("B"),
      validRow("C"),
    ];

    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({
      status: expect.stringMatching(/queued|running|completed/),
      totalRows: 3,
      numberRangeStart: 1,
    });

    // Counter has been advanced by exactly totalRows.
    const project = await t.run(async (ctx) => ctx.db.get(projectId));
    expect(project?.taskCounter).toBe(3);
  });

  it("rejects when another job is already running for the same project", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows: [validRow("A")],
    });

    // Don't advance timers — the first job stays in queued/running state.
    await expect(
      asUser.mutation(api.taskImports.createImportJob, {
        projectId,
        workspaceId,
        rows: [validRow("B")],
      }),
    ).rejects.toThrow(/already running/i);
  });

  it("rejects callers who are not workspace members", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });
    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      asOutsider.mutation(api.taskImports.createImportJob, {
        projectId,
        workspaceId,
        rows: [validRow("A")],
      }),
    ).rejects.toThrow(/not a member/i);
  });

  it("rejects malformed rows with a structured INVALID_ROWS error", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    await expect(
      asUser.mutation(api.taskImports.createImportJob, {
        projectId,
        workspaceId,
        rows: [validRow("A", { priority: "EXTREME" })],
      }),
    ).rejects.toThrow(/validation/i);
  });
});

describe("taskImports.runImport (end-to-end)", () => {
  it("creates tasks with sequential numbers and importJobId set", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows: [
        validRow("First", { priority: "high", tags: "alpha;beta" }),
        validRow("Second", { dueDate: "2026-06-01" }),
      ],
    });

    // Drain the scheduler: createImportJob enqueues runImport, runImport
    // calls createImportedTask per row. Running everything synchronously
    // is the test-env fallback inside scheduleTaskImport (VITEST guard).
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({
      status: "completed",
      processedRows: 2,
      failedRows: 0,
    });

    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_importJob", (q) => q.eq("importJobId", jobId))
        .collect(),
    );
    expect(tasks).toHaveLength(2);
    const titles = tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["First", "Second"]);
    for (const task of tasks) {
      expect(task.importJobId).toBe(jobId);
      expect(task.statusId).toBe(todoId);
      // Numbers were pre-reserved as 1 and 2.
      expect([1, 2]).toContain(task.number);
    }
  });

  it("increments failedRows when the inner mutation cannot persist a row", async () => {
    // Simulate the unusual case where a row passes phase-1 (mutation arg
    // validation + zod re-parse) but createImportedTask hits a problem.
    // We can force this by directly seeding a job doc with a row that
    // the inner safeParse will reject (e.g. priority missing entirely is
    // OK; here we use an invalid object shape that survived v.any() but
    // not zod).
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    // Seed a job with one valid + one rotten row, bypassing createImportJob.
    const jobId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: [
          { title: "OK", priority: null, tags: null, dueDate: null, plannedStartDate: null, estimate: null },
          { /* missing title */ priority: null, labels: null, dueDate: null, plannedStartDate: null, estimate: null },
        ],
        numberRangeStart: 1,
        totalRows: 2,
        processedRows: 0,
        failedRows: 0,
      });
      return id;
    });

    await t.action(internal.taskImports.runImport, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({
      status: "completed",
      processedRows: 2,
      failedRows: 1,
    });
  });
});

describe("getActiveJobForProject", () => {
  it("returns null when no job is active", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });
    const result = await asUser.query(api.taskImports.getActiveJobForProject, {
      projectId,
    });
    expect(result).toBeNull();
  });

  it("returns the running job and excludes completed jobs", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows: [validRow("A")],
    });

    // Before draining the scheduler the job is still queued/running.
    const running = await asUser.query(api.taskImports.getActiveJobForProject, {
      projectId,
    });
    expect(running?._id).toBe(jobId);

    // After completion no job should be active.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterCompletion = await asUser.query(
      api.taskImports.getActiveJobForProject,
      { projectId },
    );
    expect(afterCompletion).toBeNull();
  });
});
