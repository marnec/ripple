/**
 * Import jobs that stop without saying so.
 *
 * A `taskImportJobs` row is created `queued` and only `markCompleted` /
 * `markFailed` ever move it. The GitHub drain is a bare scheduled action —
 * at-most-once — with no try/catch around a body that can throw (a 401 from
 * GitHub's token endpoint, a transaction cap on a 50-issue batch). When it
 * died the row stayed `queued` forever, and there was no cancel, reset or
 * expiry anywhere in the backend to move it.
 *
 * That is worse than a failed import, because "queued" is what the concurrency
 * guard and the active-job banner both read: the project's Import button stays
 * disabled and every later CSV import throws `IMPORT_ALREADY_RUNNING`, with
 * nothing a user or an admin can do about it.
 *
 * These tests pin the two halves of the way out: a drain that dies says so, and
 * a job nobody is working on stops counting as active.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

let savedAppId: string | undefined;
let savedKey: string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  savedAppId = process.env.GITHUB_APP_ID;
  savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
  // Present but unusable. `githubClientFromEnv` only null-checks presence, so
  // the drain gets a client and dies later, inside `mintInstallationToken` —
  // a throw, not one of the two failure modes the handler checks for.
  process.env.GITHUB_APP_ID = "test-app-id";
  process.env.GITHUB_APP_PRIVATE_KEY =
    "-----BEGIN PRIVATE KEY-----\nGARBAGE\n-----END PRIVATE KEY-----\n";
});
afterEach(() => {
  vi.useRealTimers();
  if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = savedAppId;
  if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
  else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
});

async function setupImportableProject(t: ReturnType<typeof createTestContext>) {
  const { userId, asUser } = await setupAuthenticatedUser(t);
  const workspaceId = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", { name: "WS", ownerId: userId });
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const projectLinkId = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
    return await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
  });

  return { asUser, userId, workspaceId, projectId, projectLinkId };
}

async function readJob(
  t: ReturnType<typeof createTestContext>,
  jobId: Id<"taskImportJobs">,
) {
  return await t.run(async (ctx) => await ctx.db.get(jobId));
}

/** Seed a job stuck in `status`, having last made progress `agoMs` ago. */
async function seedStuckJob(
  t: ReturnType<typeof createTestContext>,
  opts: {
    projectId: Id<"projects">;
    workspaceId: Id<"workspaces">;
    creatorId: Id<"users">;
    status: "queued" | "running";
    lastProgressAt?: number;
  },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("taskImportJobs", {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      creatorId: opts.creatorId,
      status: opts.status,
      rows: [],
      numberRangeStart: 1,
      totalRows: 10,
      processedRows: 0,
      failedRows: 0,
      sourceType: "github_integration" as const,
      ...(opts.lastProgressAt === undefined
        ? {}
        : { lastProgressAt: opts.lastProgressAt }),
    }),
  );
}

describe("a GitHub import drain that dies", () => {
  /**
   * The wedge itself. `startGithubImport` schedules the drain; the drain throws
   * inside `mintInstallationToken`, which is neither of the two failure modes
   * the handler checks (missing credentials, non-200 fetch) and so reached no
   * `markFailed`. Draining the scheduler here runs the action to its death.
   */
  it("marks the job failed instead of leaving it queued forever", async () => {
    const t = createTestContext();
    const { asUser, projectLinkId } = await setupImportableProject(t);

    const { jobId } = await asUser.mutation(
      api.integrations.github.importStart.startGithubImport,
      {
        projectIntegrationLinkId: projectLinkId,
        includeClosed: false,
        labels: [],
        expectedTotal: 10,
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const job = await readJob(t, jobId);
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toBeTruthy();
  });

  /**
   * And the consequence that actually reaches a user: while the row reads
   * queued, the project cannot start any other import. A failed job is not
   * active, so the guard lets the next one through.
   */
  it("stops blocking the project's next import once it has failed", async () => {
    const t = createTestContext();
    const { asUser, projectId, projectLinkId } = await setupImportableProject(t);

    await asUser.mutation(
      api.integrations.github.importStart.startGithubImport,
      {
        projectIntegrationLinkId: projectLinkId,
        includeClosed: false,
        labels: [],
        expectedTotal: 10,
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(
      await asUser.query(api.taskImports.getActiveJobForProject, { projectId }),
    ).toBeNull();
  });
});

/**
 * The other half, and the one that matters for rows already wedged: a catch
 * only helps when the isolate lives long enough to run it. A job nobody is
 * working on has to stop counting as active on its own.
 *
 * Staleness is measured from the last observed progress rather than from the
 * job's age, so a legitimately long import — twenty pages of fifty issues —
 * is never mistaken for a dead one. Rows written before `lastProgressAt`
 * existed fall back to `_creationTime`, which is exactly what makes an
 * already-wedged production row self-clear on deploy.
 */
describe("an import job nobody is working on", () => {
  it("stops reading as active once it has gone quiet", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId } =
      await setupImportableProject(t);
    await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "queued",
    });

    // Far past any plausible gap between two pages of an import.
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);

    expect(
      await asUser.query(api.taskImports.getActiveJobForProject, { projectId }),
    ).toBeNull();
  });

  it("stops blocking a new import once it has gone quiet", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId } =
      await setupImportableProject(t);
    await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "queued",
    });

    vi.setSystemTime(Date.now() + 60 * 60 * 1000);

    // Asserted as a success rather than as "not IMPORT_ALREADY_RUNNING": any
    // other error would satisfy the negative form, so it would pass even if
    // the guard still rejected for a different reason.
    const jobId = await asUser.mutation(api.taskImports.createImportJob, {
      projectId,
      workspaceId,
      rows: [
        {
          title: "First task",
          priority: "medium",
          tags: "",
          dueDate: "",
          plannedStartDate: "",
          estimate: "",
        },
      ],
    });
    expect(jobId).toBeTruthy();
  });

  /**
   * The bound. A drain that is still turning pages must keep its lock — this
   * is what stops the escape hatch from becoming a way to run two imports over
   * the same pre-allocated task-number range.
   */
  it("keeps its lock while it is still making progress", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId } =
      await setupImportableProject(t);
    await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "running",
    });

    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    // A page just landed, so the job is alive however old it is.
    await t.run(async (ctx) => {
      const job = await ctx.db
        .query("taskImportJobs")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
      await ctx.db.patch(job!._id, { lastProgressAt: Date.now() });
    });

    const active = await asUser.query(api.taskImports.getActiveJobForProject, {
      projectId,
    });
    expect(active?.status).toBe("running");
  });

  /**
   * Reading past a stale row unblocks the project, but leaves it sitting at
   * `queued` forever — indistinguishable, to anyone looking at the data, from
   * a job still waiting its turn. The sweep is what actually retires it.
   */
  it("is swept to failed so the row stops lying about its status", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId } = await setupImportableProject(t);
    const jobId = await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "queued",
    });

    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await t.mutation(internal.taskImports.expireStaleImportJobs, {});

    const job = await readJob(t, jobId);
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toMatch(/no progress|stale|abandon/i);
  });

  it("leaves a job that is still making progress alone", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId } = await setupImportableProject(t);
    const jobId = await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "running",
      lastProgressAt: Date.now(),
    });

    await t.mutation(internal.taskImports.expireStaleImportJobs, {});

    expect((await readJob(t, jobId))?.status).toBe("running");
  });
});

/**
 * The manual escape. Staleness clears a wedge eventually; a user watching a
 * banner that will not go away wants it gone now, and is the one person who
 * knows the import is not coming back.
 */
describe("cancelling an import", () => {
  it("lets a project member retire a job that is not coming back", async () => {
    const t = createTestContext();
    const { asUser, projectId, projectLinkId } = await setupImportableProject(t);

    const { jobId } = await asUser.mutation(
      api.integrations.github.importStart.startGithubImport,
      {
        projectIntegrationLinkId: projectLinkId,
        includeClosed: false,
        labels: [],
        expectedTotal: 10,
      },
    );

    await asUser.mutation(api.taskImports.cancelImportJob, { jobId });

    const job = await readJob(t, jobId);
    expect(job?.status).toBe("failed");
    expect(
      await asUser.query(api.taskImports.getActiveJobForProject, { projectId }),
    ).toBeNull();
  });

  it("refuses a caller who is not a member of the job's project", async () => {
    const t = createTestContext();
    const { userId, workspaceId, projectId } = await setupImportableProject(t);
    const jobId = await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "queued",
    });

    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(
      outsider.mutation(api.taskImports.cancelImportJob, { jobId }),
    ).rejects.toThrow();
    expect((await readJob(t, jobId))?.status).toBe("queued");
  });

  /** A finished import is not a thing to cancel — and must not be reopened. */
  it("does not touch a job that already completed", async () => {
    const t = createTestContext();
    const { asUser, userId, workspaceId, projectId } =
      await setupImportableProject(t);
    const jobId = await seedStuckJob(t, {
      projectId,
      workspaceId,
      creatorId: userId,
      status: "queued",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(jobId, { status: "completed" });
    });

    await expect(
      asUser.mutation(api.taskImports.cancelImportJob, { jobId }),
    ).rejects.toThrow();
    expect((await readJob(t, jobId))?.status).toBe("completed");
  });
});
