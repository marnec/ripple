import { describe, expect, it } from "vitest";
import {
  applyImportBatch,
  createImportJob,
  filterImportEvents,
  type ImportFilterConfig,
} from "../convex/integrations/core/importJob";
import type {
  NormalizedIssueClosedEvent,
  NormalizedIssueOpenedEvent,
} from "../convex/integrations/core/types";
import type { Doc } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

const defaultAuthor = {
  login: "octocat",
  avatarUrl: "https://github.com/octocat.png",
  url: "https://github.com/octocat",
};

function makeOpenedEvent(
  overrides: Partial<NormalizedIssueOpenedEvent> = {},
): NormalizedIssueOpenedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.opened",
    externalIssueId: `I_kw_${issueNumber}`,
    issueNumber,
    externalUpdatedAt: 1_700_000_000_000,
    title: `Issue ${issueNumber}`,
    body: "",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    ...overrides,
  };
}

function makeClosedEvent(
  overrides: Partial<NormalizedIssueClosedEvent> = {},
): NormalizedIssueClosedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.closed",
    externalIssueId: `I_kw_${issueNumber}`,
    issueNumber,
    externalUpdatedAt: 1_700_000_001_000,
    title: `Issue ${issueNumber}`,
    body: "",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    stateReason: "completed",
    ...overrides,
  };
}

/**
 * Set up an integration link + bot user + triage status + a created
 * import job. Returns the ids the tests need.
 */
async function setupImportFixtures(
  t: ReturnType<typeof createTestContext>,
  opts: { totalRows?: number } = {},
) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { triageStatusId, linkId, jobId, link } = await t.run(async (ctx) => {
    const triageStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", {
      name: "GitHub",
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-123",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const link = (await ctx.db.get(linkId))!;
    // Insert a job row directly (createImportJob is tested in its own cycles).
    const jobId = await ctx.db.insert("taskImportJobs", {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "running",
      rows: [],
      numberRangeStart: 1,
      totalRows: opts.totalRows ?? 1,
      processedRows: 0,
      failedRows: 0,
      sourceType: "github_integration",
      projectIntegrationLinkId: linkId,
    });
    return { triageStatusId, linkId, jobId, link };
  });

  return {
    workspaceId,
    projectId,
    triageStatusId,
    linkId,
    jobId,
    link: link as Doc<"projectIntegrationLinks">,
    userId,
  };
}

describe("integrations/core/importJob.applyImportBatch", () => {
  it("applies a one-event batch: creates a task in triage and bumps processedRows", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId, jobId } = await setupImportFixtures(t);

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [makeOpenedEvent()],
        batchStartIndex: 0,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.statusId).toBe(triageStatusId);

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.processedRows).toBe(1);
  });

  it("applies a multi-event batch: N events create N tasks and processedRows advances by N", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t, { totalRows: 3 });

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 1 }),
          makeOpenedEvent({ issueNumber: 2 }),
          makeOpenedEvent({ issueNumber: 3 }),
        ],
        batchStartIndex: 0,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(3);

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.processedRows).toBe(3);
  });

  it("is idempotent on externalIssueId: re-applying the same batch creates no duplicate tasks", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t, { totalRows: 3 });
    const events = [
      makeOpenedEvent({ issueNumber: 1 }),
      makeOpenedEvent({ issueNumber: 2 }),
      makeOpenedEvent({ issueNumber: 3 }),
    ];

    await t.run((ctx) =>
      applyImportBatch(ctx, { jobId, events, batchStartIndex: 0 }),
    );
    // Re-apply: simulates a retried drain or a duplicated paginated page.
    await t.run((ctx) =>
      applyImportBatch(ctx, { jobId, events, batchStartIndex: 0 }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(3);
  });

  it("assigns each created task a number from the pre-allocated range (numberRangeStart + index)", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t, { totalRows: 3 });
    // Force the job to use a non-trivial numberRangeStart.
    await t.run((ctx) => ctx.db.patch(jobId, { numberRangeStart: 11 }));

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 100 }),
          makeOpenedEvent({ issueNumber: 200 }),
          makeOpenedEvent({ issueNumber: 300 }),
        ],
        batchStartIndex: 0,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const numbersByExternalIssue = Object.fromEntries(
      tasks.map((task) => [
        task.externalRefs?.[0]?.issueNumber,
        task.number,
      ]),
    );
    // Order is preserved (sequential awaits), so external issue 100 gets 11,
    // 200 gets 12, 300 gets 13.
    expect(numbersByExternalIssue).toEqual({ 100: 11, 200: 12, 300: 13 });
  });

  it("stamps tasks.importJobId on every task created via import for reverse lookup", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t, { totalRows: 2 });

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 1 }),
          makeOpenedEvent({ issueNumber: 2 }),
        ],
        batchStartIndex: 0,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      expect(task.importJobId).toBe(jobId);
    }
  });

  it("offsets task numbers by batchStartIndex across successive batches", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t, { totalRows: 4 });
    await t.run((ctx) => ctx.db.patch(jobId, { numberRangeStart: 50 }));

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 1 }),
          makeOpenedEvent({ issueNumber: 2 }),
        ],
        batchStartIndex: 0,
      }),
    );
    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 3 }),
          makeOpenedEvent({ issueNumber: 4 }),
        ],
        batchStartIndex: 2,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const numbersByExternalIssue = Object.fromEntries(
      tasks.map((task) => [
        task.externalRefs?.[0]?.issueNumber,
        task.number,
      ]),
    );
    expect(numbersByExternalIssue).toEqual({ 1: 50, 2: 51, 3: 52, 4: 53 });
  });

  it("routes closed events in the batch to the appropriate completed status (orphan-close upsert)", async () => {
    const t = createTestContext();
    const { projectId, jobId } = await setupImportFixtures(t);
    const doneStatusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Done",
        color: "bg-gray-500",
        order: 1,
        isDefault: false,
        isCompleted: true,
      }),
    );

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [makeClosedEvent({ issueNumber: 7 })],
        batchStartIndex: 0,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.statusId).toBe(doneStatusId);
    expect(tasks[0]?.completed).toBe(true);
  });

  it("accumulates processedRows across successive batches", async () => {
    const t = createTestContext();
    const { jobId } = await setupImportFixtures(t, { totalRows: 5 });

    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 1 }),
          makeOpenedEvent({ issueNumber: 2 }),
        ],
        batchStartIndex: 0,
      }),
    );
    await t.run((ctx) =>
      applyImportBatch(ctx, {
        jobId,
        events: [
          makeOpenedEvent({ issueNumber: 3 }),
          makeOpenedEvent({ issueNumber: 4 }),
          makeOpenedEvent({ issueNumber: 5 }),
        ],
        batchStartIndex: 2,
      }),
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.processedRows).toBe(5);
  });
});

describe("integrations/core/importJob.createImportJob", () => {
  it("pre-allocates the task-number range and advances project.taskCounter atomically", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    // Seed an existing counter so the test exercises a non-zero starting point.
    await t.run((ctx) => ctx.db.patch(projectId, { taskCounter: 10 }));
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME1",
      }),
    );

    const jobId = await t.run((ctx) =>
      createImportJob(ctx, {
        workspaceId,
        projectId,
        creatorId: userId,
        projectIntegrationLinkId: linkId,
        totalRows: 50,
      }),
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.numberRangeStart).toBe(11);
    expect(job?.totalRows).toBe(50);

    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.taskCounter).toBe(60);
  });

  it("initializes the job row with queued status, github_integration source, and zero counters", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME2",
      }),
    );

    const jobId = await t.run((ctx) =>
      createImportJob(ctx, {
        workspaceId,
        projectId,
        creatorId: userId,
        projectIntegrationLinkId: linkId,
        totalRows: 25,
      }),
    );

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("queued");
    expect(job?.sourceType).toBe("github_integration");
    expect(job?.projectIntegrationLinkId).toBe(linkId);
    expect(job?.processedRows).toBe(0);
    expect(job?.failedRows).toBe(0);
    expect(job?.rows).toEqual([]);
  });
});

describe("integrations/core/importJob.filterImportEvents", () => {
  it("drops issue.closed events when includeClosed is false (open-only default)", () => {
    const config: ImportFilterConfig = { includeClosed: false };
    const events = [
      makeOpenedEvent({ issueNumber: 1 }),
      makeClosedEvent({ issueNumber: 2 }),
      makeOpenedEvent({ issueNumber: 3 }),
    ];

    const kept = filterImportEvents(events, config);

    expect(kept).toHaveLength(2);
    expect(kept.map((e) => e.issueNumber)).toEqual([1, 3]);
  });

  it("keeps both issue.opened and issue.closed when includeClosed is true", () => {
    const config: ImportFilterConfig = { includeClosed: true };
    const events = [
      makeOpenedEvent({ issueNumber: 1 }),
      makeClosedEvent({ issueNumber: 2 }),
      makeOpenedEvent({ issueNumber: 3 }),
    ];

    const kept = filterImportEvents(events, config);

    expect(kept).toHaveLength(3);
    expect(kept.map((e) => e.issueNumber)).toEqual([1, 2, 3]);
  });
});

