import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { NormalizedCommentCreatedEvent } from "../convex/integrations/core/types";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";

/**
 * The action scheduled by `taskComments.{create,update,remove}` runs under
 * Node and reads `process.env.GITHUB_APP_*`. We unset them so that *if* the
 * action runs, it takes the missing-creds branch and writes a recorded
 * failure to the comment row / link row — an observable "did the action run?"
 * signal without needing to mock HTTP. Mirrors the existing tests in
 * `integrations.syncOut.test.ts`.
 */
async function setupTaskAndLink(
  t: ReturnType<typeof createTestContext>,
  opts: {
    linkStatus?: "configuring" | "active" | "paused" | "disconnected";
    pausedByBilling?: boolean;
    withIntegrationLink?: boolean;
  } = {},
) {
  const {
    linkStatus = "active",
    pausedByBilling = false,
    withIntegrationLink = true,
  } = opts;

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

  const { taskId } = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const todoStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 1,
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
      status: linkStatus,
      pausedByBilling,
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
      assigneeId: userId,
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
    if (withIntegrationLink) {
      await ctx.db.insert("taskIntegrationLinks", {
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
    return { taskId };
  });

  return { asUser, workspaceId, projectId, taskId };
}

async function readCommentLastSyncError(
  t: ReturnType<typeof createTestContext>,
  commentId: string,
) {
  return t.run(async (ctx) => {
    const c = await ctx.db.get(commentId as never);
    return (c as { lastSyncError?: unknown } | null)?.lastSyncError;
  });
}

describe("taskComments.create outbound dispatch", () => {
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

  it("linked task → action fires (lastSyncError records the missing-creds branch)", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "Ripple-side comment",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readCommentLastSyncError(t, commentId);
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toMatch(
      /credentials not configured/i,
    );
  });

  it("task has no taskIntegrationLinks row → no action scheduled", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t, {
      withIntegrationLink: false,
    });

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "Ripple-native comment",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readCommentLastSyncError(t, commentId)).toBeFalsy();
  });

  it("link is admin-paused → no action scheduled", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t, {
      linkStatus: "paused",
    });

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "x",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readCommentLastSyncError(t, commentId)).toBeFalsy();
  });

  it("link is entitlement-frozen (pausedByBilling=true) → no action scheduled", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t, {
      pausedByBilling: true,
    });

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "x",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readCommentLastSyncError(t, commentId)).toBeFalsy();
  });

  it("echo guard: inbound-inserted comment does NOT trigger an outbound dispatch", async () => {
    // When the integration's inbound webhook inserts a comment via syncIn,
    // we must NOT bounce it back to GitHub. The inbound path uses db.insert
    // directly (not the public mutation), so no dispatcher runs — this test
    // is the regression guard against any future refactor that funnels
    // inbound through the public mutation.
    const t = createTestContext();
    const { taskId, projectId } = await setupTaskAndLink(t);

    const { link } = await t.run(async (ctx) => {
      const linkRow = await ctx.db
        .query("projectIntegrationLinks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .unique();
      return { link: linkRow! };
    });

    const event: NormalizedCommentCreatedEvent = {
      kind: "comment.created",
      externalCommentId: "IC_kwDO_INBOUND",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: 1_700_000_010_000,
      body: "From GitHub",
      externalAuthor: {
        login: "external-user",
        avatarUrl: "https://github.com/external-user.png",
        url: "https://github.com/external-user",
      },
    };
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Find the comment that was just inserted.
    const comments = await t.run((ctx) =>
      ctx.db
        .query("taskComments")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(comments).toHaveLength(1);
    // Inbound comment row never gets a lastSyncError (no outbound was fired).
    expect(
      (comments[0] as { lastSyncError?: unknown }).lastSyncError,
    ).toBeFalsy();
  });
});

describe("taskComments.update outbound dispatch", () => {
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

  it("update on a comment with a comment-link row → action fires (lastSyncError on the link row)", async () => {
    // Seed a comment + a comment link (simulating a previously-successful
    // outbound create). The update should dispatch a PATCH; with creds
    // unset, the action records a permanent failure on the link row.
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "original",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Manually seed the link row so update has a target externalCommentId.
    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .unique();
      await ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: commentId as never,
        taskIntegrationLinkId: link!._id,
        externalCommentId: "IC_kwDOABC123_1",
        externalUpdatedAt: 1_700_000_000_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      });
      // Clear the prior lastSyncError from the create.
      await ctx.db.patch(commentId as never, { lastSyncError: undefined });
    });

    await asUser.mutation(api.taskComments.update, {
      id: commentId,
      body: "edited",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) =>
      ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId as never))
        .unique(),
    );
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/credentials not configured/i);
  });

  it("update on a comment with no link → no action scheduled", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t, {
      withIntegrationLink: false,
    });

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "x",
    });
    await asUser.mutation(api.taskComments.update, {
      id: commentId,
      body: "y",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readCommentLastSyncError(t, commentId)).toBeFalsy();
  });
});

describe("taskComments.remove outbound dispatch", () => {
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

  it("remove on a linked comment → action fires (lastSyncError recorded on the link)", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "original",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .unique();
      await ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: commentId as never,
        taskIntegrationLinkId: link!._id,
        externalCommentId: "IC_kwDOABC123_1",
        externalUpdatedAt: 1_700_000_000_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      });
      await ctx.db.patch(commentId as never, { lastSyncError: undefined });
    });

    await asUser.mutation(api.taskComments.remove, { id: commentId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) =>
      ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId as never))
        .unique(),
    );
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/credentials not configured/i);
  });

  it("remove on an unlinked comment → no action scheduled", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskAndLink(t, {
      withIntegrationLink: false,
    });
    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "x",
    });
    await asUser.mutation(api.taskComments.remove, { id: commentId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readCommentLastSyncError(t, commentId)).toBeFalsy();
  });
});
