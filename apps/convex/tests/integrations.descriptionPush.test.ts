import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

/**
 * The action scheduled by `tasks.syncDescriptionToGitHub` runs under
 * Node and reads `process.env.GITHUB_APP_*`. We unset them so that *if* the
 * action runs, it takes the missing-creds branch and writes a recorded
 * failure to the link row — an observable "did the action run?" signal
 * without mocking HTTP. Mirrors the existing tests in
 * `integrations.syncOut.test.ts`.
 */
async function setupTask(
  t: ReturnType<typeof createTestContext>,
  opts: { withIntegrationLink?: boolean } = {},
) {
  const { withIntegrationLink = true } = opts;
  const { userId, asUser } = await setupAuthenticatedUser(t);
  const workspaceId = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", {
      name: "WS",
      ownerId: userId,
    });
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { taskId, taskLinkId } = await t.run(async (ctx) => {
    const todoStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const botUserId = await ctx.db.insert("users", {
      name: "GitHub",
      isBot: true,
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const taskId = await ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "task",
      statusId: todoStatusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      externalRefs: withIntegrationLink
        ? [
            {
              provider: "github",
              repoFullName: "acme/web",
              issueNumber: 42,
              url: "https://github.com/acme/web/issues/42",
            },
          ]
        : undefined,
    });
    let taskLinkId: Id<"taskIntegrationLinks"> | null = null;
    if (withIntegrationLink) {
      taskLinkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kwDOABC123",
        externalUpdatedAt: 1_700_000_000_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      });
    }
    return { taskId, taskLinkId };
  });

  return { asUser, workspaceId, projectId, taskId, taskLinkId };
}

const SAMPLE_MARKDOWN = "# Hello\n\nThis is **the** body.";

describe("tasks.syncDescriptionToGitHub (outbound description push)", () => {
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

  it("linked task → schedules the push action (missing creds → lastSyncError set on link)", async () => {
    const t = createTestContext();
    const { asUser, taskLinkId, taskId } = await setupTask(t);

    await asUser.mutation(api.tasks.syncDescriptionToGitHub, {
      taskId,
      markdown: SAMPLE_MARKDOWN,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(taskLinkId!));
    expect(link).not.toBeNull();
    expect(link!.lastSyncError).toBeDefined();
    expect(link!.lastSyncError!.message).toMatch(/credentials not configured/i);
  });

  it("task with no integration link → throws (nothing to push to)", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTask(t, {
      withIntegrationLink: false,
    });

    await expect(
      asUser.mutation(api.tasks.syncDescriptionToGitHub, {
        taskId,
        markdown: SAMPLE_MARKDOWN,
      }),
    ).rejects.toThrow(/not linked|no.*link/i);
  });

  it("recording a successful description push logs a description_synced activity", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTask(t);

    await t.mutation(internal.integrations.github.syncOutMutations.recordTaskOutboundResult, {
      taskId,
      result: { op: "description" },
    });

    const timeline = await asUser.query(api.taskActivity.timeline, { taskId });
    const synced = timeline.find(
      (i) => i.kind === "activity" && i.type === "description_synced",
    );
    expect(synced).toBeDefined();
    expect(synced?.source).toBe("integration");
  });

  it("non-workspace-member calling sync → rejected", async () => {
    const t = createTestContext();
    const { taskId } = await setupTask(t);
    const { asUser: asOutsider } = await setupAuthenticatedUser(t, {
      email: "outsider@test.com",
    });

    await expect(
      asOutsider.mutation(api.tasks.syncDescriptionToGitHub, {
        taskId,
        markdown: SAMPLE_MARKDOWN,
      }),
    ).rejects.toThrow();
  });
});
