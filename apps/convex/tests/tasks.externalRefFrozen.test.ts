import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { withTriggers } from "../convex/dbTriggers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * The disconnect cascade stamps `tasks.externalRefFrozen` onto every task that
 * had a linked issue. Every task-returning query spreads the raw doc against a
 * validator built from `baseTaskFields`, so a column that exists in the schema
 * but not in that validator takes the whole query down — not just the affected
 * card — the moment an admin unlinks a repo.
 *
 * These tests read through the PUBLIC queries after a real `unlinkLink`, which
 * is the gap that let this ship green: tests/integrations.disconnect.test.ts
 * asserts the column is written, but only ever reads it back via `t.run`.
 */
async function setupLinkedWorkspace(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { linkId, taskId } = await t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });

    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId,
      workspaceId,
      title: "linked task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      // Assigned so `listByAssignee` (workspace-wide My Tasks) reaches it, and
      // left without a `plannedStartDate` so `listUnscheduled` does too.
      assigneeId: userId,
      externalRefs: [
        {
          provider: "github",
          repoFullName: "acme/web",
          issueNumber: 100,
          url: "https://github.com/acme/web/issues/100",
        },
      ],
    });
    await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: linkId,
      externalIssueId: "I_kwDOABC0",
      externalUpdatedAt: 1_700_000_000_000,
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://github.com/octocat.png",
        url: "https://github.com/octocat",
      },
    });

    return { linkId, taskId };
  });

  return { userId, workspaceId, projectId, asUser, linkId, taskId };
}

/** Run the real disconnect cascade to completion. */
async function unlink(
  t: ReturnType<typeof createTestContext>,
  asUser: ReturnType<typeof createTestContext>,
  linkId: Id<"projectIntegrationLinks">,
) {
  await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("task queries survive a disconnected integration", () => {
  it("tasks.get returns a task carrying externalRefFrozen", async () => {
    const t = createTestContext();
    const { asUser, linkId, taskId } = await setupLinkedWorkspace(t);

    await unlink(t, asUser, linkId);

    const task = await asUser.query(api.tasks.get, { taskId });
    expect(task).not.toBeNull();
    expect(task!.title).toBe("linked task");
    expect(task!.externalRefFrozen?.repoFullName).toBe("acme/web");
  });

  it("tasks.listByProject returns the project's tasks", async () => {
    const t = createTestContext();
    const { asUser, linkId, projectId, taskId } = await setupLinkedWorkspace(t);

    await unlink(t, asUser, linkId);

    const tasks = await asUser.query(api.tasks.listByProject, {
      projectId,
      completed: false,
    });
    expect(tasks.map((task) => task._id)).toContain(taskId);
  });

  it("tasks.listByAssignee returns the assignee's tasks across the workspace", async () => {
    const t = createTestContext();
    const { asUser, linkId, workspaceId, taskId } = await setupLinkedWorkspace(t);

    await unlink(t, asUser, linkId);

    const tasks = await asUser.query(api.tasks.listByAssignee, {
      workspaceId,
      completed: false,
    });
    expect(tasks.map((task) => task._id)).toContain(taskId);
  });

  it("tasks.listUnscheduled returns the project's undated tasks", async () => {
    const t = createTestContext();
    const { asUser, linkId, projectId, taskId } = await setupLinkedWorkspace(t);

    await unlink(t, asUser, linkId);

    const tasks = await asUser.query(api.tasks.listUnscheduled, { projectId });
    expect(tasks.map((task) => task._id)).toContain(taskId);
  });

  it("cycles.listCycleTasks returns the cycle's tasks", async () => {
    const t = createTestContext();
    const { userId, asUser, linkId, workspaceId, projectId, taskId } =
      await setupLinkedWorkspace(t);

    const cycleId = await t.run(async (ctx) => {
      const cycleId = await ctx.db.insert("cycles", {
        projectId,
        workspaceId,
        name: "Sprint 1",
        status: "active",
        creatorId: userId,
      });
      await ctx.db.insert("cycleTasks", {
        cycleId,
        taskId,
        projectId,
        addedBy: userId,
      });
      return cycleId;
    });

    await unlink(t, asUser, linkId);

    const tasks = await asUser.query(api.cycles.listCycleTasks, { cycleId });
    expect(tasks.map((task) => task._id)).toContain(taskId);
  });

  it("taskImports.listJobTasks returns the job's imported tasks", async () => {
    const t = createTestContext();
    const { userId, asUser, linkId, workspaceId, projectId, taskId } =
      await setupLinkedWorkspace(t);

    const jobId = await t.run(async (ctx) => {
      const jobId = await ctx.db.insert("taskImportJobs", {
        projectId,
        workspaceId,
        creatorId: userId,
        status: "completed",
        rows: [],
        numberRangeStart: 1,
        totalRows: 1,
        processedRows: 1,
        failedRows: 0,
        sourceType: "github_integration",
      });
      await ctx.db.patch(taskId, { importJobId: jobId });
      return jobId;
    });

    await unlink(t, asUser, linkId);

    const tasks = await asUser.query(api.taskImports.listJobTasks, { jobId });
    expect(tasks.map((task) => task._id)).toContain(taskId);
  });
});
