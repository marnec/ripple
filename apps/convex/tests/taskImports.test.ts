import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
  setupAuthenticatedUser,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import {
  TASK_IMPORT_EXAMPLE_ROW,
  TASK_IMPORT_TASK_LIST_LIMIT,
} from "@ripple/shared/taskImportSchema";

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

  it("skips the template's example row instead of importing it", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      // As downloaded, with the example left in place above the real rows.
      rows: [TASK_IMPORT_EXAMPLE_ROW, validRow("A"), validRow("B")],
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.totalRows).toBe(2);
    // The skipped row must not eat a task number either.
    const project = await t.run(async (ctx) => ctx.db.get(projectId));
    expect(project?.taskCounter).toBe(2);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const titles = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("tasks")
          .withIndex("by_importJob", (q) => q.eq("importJobId", jobId))
          .collect()
      ).map((task) => task.title),
    );
    expect(titles.sort()).toEqual(["A", "B"]);
  });

  it("refuses a file that is nothing but the example row", async () => {
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
        rows: [TASK_IMPORT_EXAMPLE_ROW],
      }),
    ).rejects.toThrow(/example row/i);
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
    // calls createImportedTasks per batch of rows. Running everything
    // synchronously is the test-env fallback inside scheduleTaskImport
    // (VITEST guard).
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
    // The mutation receives raw CSV cells and owns the transform: a "a;b"
    // tags cell has to reach the task as a labels array, not a string.
    const first = tasks.find((t) => t.title === "First");
    expect(first?.labels).toEqual(["alpha", "beta"]);
    expect(first?.priority).toBe("high");
    for (const task of tasks) {
      expect(task.importJobId).toBe(jobId);
      expect(task.statusId).toBe(todoId);
      // Numbers were pre-reserved as 1 and 2.
      expect([1, 2]).toContain(task.number);
    }
  });

  it("increments failedRows when the inner mutation cannot persist a row", async () => {
    // Simulate the unusual case where a row passes phase-1 (mutation arg
    // validation + zod re-parse) but createImportedTasks hits a problem.
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
    // The count alone tells the user nothing they can act on — the reason
    // has to reach the status page, naming the row and the column.
    // The seeded row is missing both `title` and `tags` (it still carries the
    // pre-rename `labels`), and each bad column is reported on its own.
    expect(job?.rowErrors).toEqual([
      { row: 2, field: "title", message: "title is required" },
      { row: 2, field: "tags", message: "tags must be text separated by ;" },
    ]);
  });

  it("explains a batch that dies as a whole, instead of just counting it", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);

    // A project with no statuses: every row is unimportable, and for a
    // reason no per-row message can express.
    const projectId = await t.run(async (ctx) =>
      ctx.db.insert("projects", {
        name: "Statusless",
        color: "bg-blue-500",
        workspaceId,
        creatorId: userId,
        key: "STA",
        taskCounter: 0,
      }),
    );
    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "queued",
        rows: [
          {
            title: "OK",
            priority: null,
            tags: null,
            dueDate: null,
            plannedStartDate: null,
            estimate: null,
          },
        ],
        numberRangeStart: 1,
        totalRows: 1,
        processedRows: 0,
        failedRows: 0,
      }),
    );

    await t.action(internal.taskImports.runImport, { jobId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({ status: "failed", failedRows: 1 });
    expect(job?.errorMessage).toMatch(/no default task status/i);
    expect(job?.rowErrors?.[0]?.message).toMatch(
      /Row 1 could not be imported: .*no default task status/i,
    );
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

describe("listJobTasks", () => {
  /** Seed `count` tasks against one job, oldest first, titled "Row <i>". */
  async function seedJobTasks(
    t: ReturnType<typeof createTestContext>,
    opts: {
      workspaceId: Id<"workspaces">;
      projectId: Id<"projects">;
      statusId: Id<"taskStatuses">;
      userId: Id<"users">;
      count: number;
    },
  ) {
    return await t.run(async (ctx) => {
      const jobId = await ctx.db.insert("taskImportJobs", {
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
        creatorId: opts.userId,
        status: "completed",
        rows: [],
        numberRangeStart: 1,
        totalRows: opts.count,
        processedRows: opts.count,
        failedRows: 0,
      });
      for (let i = 0; i < opts.count; i++) {
        await ctx.db.insert("tasks", {
          projectId: opts.projectId,
          workspaceId: opts.workspaceId,
          title: `Row ${i}`,
          statusId: opts.statusId,
          priority: "medium",
          completed: false,
          creatorId: opts.userId,
          importJobId: jobId,
        });
      }
      return jobId;
    });
  }

  // The read set is a range the import is actively writing into, so it has to
  // stay flat as the job grows — this is the assertion that stops someone
  // restoring the `.collect()`.
  it("caps the list at the shared limit and keeps the newest rows", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });

    const overflow = 5;
    const jobId = await seedJobTasks(t, {
      workspaceId,
      projectId,
      statusId: todoId,
      userId,
      count: TASK_IMPORT_TASK_LIST_LIMIT + overflow,
    });

    const tasks = await asUser.query(api.taskImports.listJobTasks, { jobId });

    expect(tasks).toHaveLength(TASK_IMPORT_TASK_LIST_LIMIT);
    // Newest first: the last row seeded is at the top, and the `overflow`
    // oldest rows are the ones dropped.
    expect(tasks[0].title).toBe(`Row ${TASK_IMPORT_TASK_LIST_LIMIT + overflow - 1}`);
    const titles = new Set(tasks.map((task) => task.title));
    expect(titles.has(`Row ${overflow}`)).toBe(true);
    expect(titles.has(`Row ${overflow - 1}`)).toBe(false);
    expect(titles.has("Row 0")).toBe(false);
  });

  // `enrichTasks` resolves status and assignee out of `getAll`-built maps
  // rather than a point read per task; a mis-keyed map would silently null
  // these out and the page would render blank chips.
  it("enriches each task with its own status and assignee", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProjectWithStatuses(t, {
      workspaceId,
      userId,
    });
    const { userId: otherUserId } = await setupAuthenticatedUser(t, {
      email: "assignee@example.com",
    });

    const { jobId, doneId, assignedTaskId } = await t.run(async (ctx) => {
      const doneId = (
        await ctx.db
          .query("taskStatuses")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .collect()
      ).find((status) => status.name === "Done")!._id;

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
      await ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "Unassigned",
        statusId: todoId,
        priority: "medium",
        completed: false,
        creatorId: userId,
        importJobId: jobId,
      });
      const assignedTaskId = await ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "Assigned",
        statusId: doneId,
        priority: "medium",
        completed: true,
        creatorId: userId,
        assigneeId: otherUserId,
        importJobId: jobId,
      });
      return { jobId, doneId, assignedTaskId };
    });

    const tasks = await asUser.query(api.taskImports.listJobTasks, { jobId });
    const byTitle = new Map(tasks.map((task) => [task.title, task]));

    const assigned = byTitle.get("Assigned")!;
    expect(assigned._id).toBe(assignedTaskId);
    expect(assigned.status?._id).toBe(doneId);
    expect(assigned.assignee?._id).toBe(otherUserId);
    expect(assigned.projectKey).toBe("IMP");

    const unassigned = byTitle.get("Unassigned")!;
    expect(unassigned.status?._id).toBe(todoId);
    expect(unassigned.assignee).toBeNull();
  });
});
