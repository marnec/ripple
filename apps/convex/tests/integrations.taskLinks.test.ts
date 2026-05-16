import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

describe("integrations/taskLinks.getByTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setupLinkedTask(
    t: ReturnType<typeof createTestContext>,
    opts: { withLink: boolean; withError?: boolean } = { withLink: true },
  ) {
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "T",
        statusId,
        priority: "medium",
        completed: false,
        creatorId: userId,
        externalRefs: opts.withLink
          ? [
              {
                provider: "github",
                repoFullName: "acme/web",
                issueNumber: 42,
                url: "https://github.com/acme/web/issues/42",
              },
            ]
          : undefined,
      }),
    );

    let linkId: Id<"taskIntegrationLinks"> | undefined;
    if (opts.withLink) {
      const botUserId = await t.run((ctx) =>
        ctx.db.insert("users", { name: "GitHub", isBot: true }),
      );
      await t.run((ctx) =>
        ctx.db.insert("workspaceIntegrations", {
          workspaceId,
          botUserId,
          provider: "github",
          externalAccountId: "install-1",
        }),
      );
      const projectLinkId = await t.run((ctx) =>
        ctx.db.insert("projectIntegrationLinks", {
          projectId,
          workspaceId,
          status: "active",
          pausedByBilling: false,
          externalRepoId: "R_kg1",
          externalRepoFullName: "acme/web",
        }),
      );
      linkId = await t.run((ctx) =>
        ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: projectLinkId,
          externalIssueId: "I_kg1",
          externalUpdatedAt: 1_000,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://avatars/octocat.png",
            url: "https://github.com/octocat",
          },
          externalState: "open",
          ...(opts.withError && {
            lastSyncError: {
              occurredAt: 9_999,
              message: "HTTP 422 Unprocessable Entity",
              httpStatus: 422,
            },
          }),
        }),
      );
    }

    return { taskId, linkId, workspaceId, projectId, asUser };
  }

  it("returns null when the task has no integration link (Ripple-native)", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await setupLinkedTask(t, { withLink: false });

    const result = await asUser.query(
      api.integrations.core.taskLinks.getByTask,
      { taskId },
    );
    expect(result).toBeNull();
  });

  it("returns lastSyncError + externalIssueUrl when the link has a recorded failure", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await setupLinkedTask(t, {
      withLink: true,
      withError: true,
    });

    const result = await asUser.query(
      api.integrations.core.taskLinks.getByTask,
      { taskId },
    );
    expect(result).not.toBeNull();
    expect(result?.lastSyncError).toMatchObject({
      message: "HTTP 422 Unprocessable Entity",
      httpStatus: 422,
    });
    expect(result?.externalIssueUrl).toBe(
      "https://github.com/acme/web/issues/42",
    );
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { taskId } = await setupLinkedTask(t, { withLink: true });
    // Different identity, not a member of the workspace.
    const outsider = t.withIdentity({
      subject: "stranger|test-session",
      issuer: "test",
      name: "Stranger",
      email: "stranger@example.com",
    });

    await expect(
      outsider.query(api.integrations.core.taskLinks.getByTask, { taskId }),
    ).rejects.toThrow();
  });
});

describe("tasks.retryOutboundSync", () => {
  // Same env-var trick as syncOut tests: with credentials unset, the
  // re-enqueued action records `lastSyncError` again. That's our observable
  // proof that retry actually re-triggers the outbound push.
  let savedAppId: string | undefined;
  let savedKey: string | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (savedAppId !== undefined) process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  it("clears the existing lastSyncError and re-enqueues the outbound push", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Done",
        color: "bg-green-500",
        order: 0,
        isDefault: true,
        isCompleted: true,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "T",
        statusId,
        priority: "medium",
        completed: true,
        creatorId: userId,
        externalRefs: [
          {
            provider: "github",
            repoFullName: "acme/web",
            issueNumber: 42,
            url: "https://github.com/acme/web/issues/42",
          },
        ],
      }),
    );
    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub", isBot: true }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
      }),
    );
    const projectLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        projectId,
        workspaceId,
        status: "active",
        pausedByBilling: false,
        externalRepoId: "R_kg1",
        externalRepoFullName: "acme/web",
      }),
    );
    const linkId = await t.run((ctx) =>
      ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://x.test/octocat.png",
          url: "https://github.com/octocat",
        },
        externalState: "open",
        lastSyncError: {
          occurredAt: 1_000,
          message: "old error",
          httpStatus: 422,
        },
      }),
    );

    await asUser.mutation(api.tasks.retryOutboundSync, { taskId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    // After draining: action ran (env vars unset → records missing-creds
    // failure). The lastSyncError is set again, but with a *new* message
    // proving the dispatch path re-fired rather than leaving the old error in
    // place.
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).not.toBe("old error");
    expect(link?.lastSyncError?.message).toMatch(/credentials not configured/i);
  });
});
