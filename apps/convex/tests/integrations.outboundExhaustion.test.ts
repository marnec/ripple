/**
 * What an outbound push leaves behind when the retrier gives up.
 *
 * `runProviderOutbound` records a failure only for a *classified*
 * `permanent_fail`; a transient one throws to hand control back to the retrier
 * (`core/runOutboundAction.ts`). So after `maxFailures: 4` are spent on the
 * retryable path, the only thing that can still write anything is the retrier's
 * `onComplete` — and for most ops there wasn't one. The push was dropped with
 * the UI still rendering the row as normally synced.
 *
 * Exhaustion is driven the way `integrations.syncOut.test.ts` already drives it:
 * a syntactically-valid but garbage private key makes `signAppJwt` throw on
 * every attempt, which is a throw rather than a classified response, so it takes
 * the retryable path exactly as a 502 would. `delete`ing the credentials instead
 * would take the *permanent* branch, which has always recorded itself — that is
 * the control these tests must not accidentally be running.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { api } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import {
  enqueueIssueClose,
  enqueueIssueCreate,
  maybeEnqueueAssigneesPush,
  maybeEnqueueLabelsPush,
} from "../convex/integrations/core/outboundDispatch";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

const GARBAGE_KEY =
  "-----BEGIN PRIVATE KEY-----\nGARBAGE\n-----END PRIVATE KEY-----\n";

let savedAppId: string | undefined;
let savedKey: string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  savedAppId = process.env.GITHUB_APP_ID;
  savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
  // Present but unusable: every attempt throws inside `signAppJwt`, which the
  // classifier never sees, so the retrier treats it as transient and burns the
  // whole budget. This is the seam a real GitHub 502 arrives through.
  process.env.GITHUB_APP_ID = "test-app-id";
  process.env.GITHUB_APP_PRIVATE_KEY = GARBAGE_KEY;
});
afterEach(() => {
  vi.useRealTimers();
  if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = savedAppId;
  if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
  else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
});

/** A workspace with a GitHub integration, an active repo link, and one task. */
async function setupLinkedTask(
  t: ReturnType<typeof createTestContext>,
  opts: { withTaskLink?: boolean } = {},
) {
  const { withTaskLink = true } = opts;
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

  const ids = await t.run(async (ctx) => {
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
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      assigneeId: userId,
      labels: [],
      externalRefs: withTaskLink
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
    const taskLinkId = withTaskLink
      ? await ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: projectLinkId,
          externalIssueId: "I_kwDOABC123",
          externalUpdatedAt: 1_700_000_000_000,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://github.com/octocat.png",
            url: "https://github.com/octocat",
          },
          externalState: "open" as const,
        })
      : undefined;
    return { projectLinkId, taskId, taskLinkId };
  });
  return { asUser, userId, workspaceId, projectId, ...ids };
}

async function drain(t: ReturnType<typeof createTestContext>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("comment-create push", () => {
  /**
   * The finding's headline scenario: a user posts a comment on a linked task
   * while the provider is briefly returning 502s. Every attempt classifies
   * retryable and throws, the retrier gives up, and no
   * `taskCommentIntegrationLinks` row is ever written — so without an
   * `onComplete` the comment renders as normally synced while it was never
   * posted to the issue.
   */
  it("records the exhaustion on the comment so the sync-failed affordance shows", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupLinkedTask(t);

    const commentId = await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "Ripple-side comment",
      bodyMarkdown: "Ripple-side comment",
    });
    await drain(t);

    const comment = await t.run(async (ctx) => await ctx.db.get(commentId));
    expect(comment?.lastSyncError).toBeDefined();
    expect(comment?.lastSyncError?.message).toMatch(/exhaust/i);
  });
});

/**
 * Edit and delete differ from create in where the failure lands: by then the
 * `taskCommentIntegrationLinks` row exists, and it — not the comment — is what
 * every later echo and edit resolves through, so it is the row that has to
 * carry the error.
 */
describe("comment edit and delete pushes", () => {
  /** A comment that already synced once, so it has a link row to mark. */
  async function seedLinkedComment(
    t: ReturnType<typeof createTestContext>,
    taskId: Id<"tasks">,
    taskLinkId: Id<"taskIntegrationLinks">,
    userId: Id<"users">,
  ) {
    return await t.run(async (ctx) => {
      const commentId = await ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: JSON.stringify([{ type: "paragraph" }]),
        deleted: false,
      });
      const commentLinkId = await ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: commentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "IC_kw1",
        externalUpdatedAt: 1_700_000_000_000,
      });
      return { commentId, commentLinkId };
    });
  }

  it("records an exhausted edit on the comment link row", async () => {
    const t = createTestContext();
    const { asUser, userId, taskId, taskLinkId } = await setupLinkedTask(t);
    const { commentId, commentLinkId } = await seedLinkedComment(
      t,
      taskId,
      taskLinkId!,
      userId,
    );

    await asUser.mutation(api.taskComments.update, {
      id: commentId,
      body: JSON.stringify([{ type: "paragraph" }]),
      bodyMarkdown: "edited",
    });
    await drain(t);

    const link = await t.run(async (ctx) => await ctx.db.get(commentLinkId));
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/exhaust/i);
  });

  /**
   * Delete is the awkward one: the local comment is gone by the time the push
   * runs, so the link row it left behind is the only thing left to mark — which
   * is exactly why the delete dispatcher reads its target *before* the cascade.
   */
  it("records an exhausted delete on the comment link row", async () => {
    const t = createTestContext();
    const { asUser, userId, taskId, taskLinkId } = await setupLinkedTask(t);
    const { commentId, commentLinkId } = await seedLinkedComment(
      t,
      taskId,
      taskLinkId!,
      userId,
    );

    await asUser.mutation(api.taskComments.remove, { id: commentId });
    await drain(t);

    const link = await t.run(async (ctx) => await ctx.db.get(commentLinkId));
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/exhaust/i);
  });
});

/**
 * The two task-keyed ops that were left out when `issueState` and `description`
 * got their tracking. Same sink as those two — the task's link row — so this is
 * purely the wiring that was missing, and the assertion is the one
 * `integrations.syncOut.test.ts` already makes for the ops that had it.
 */
describe("label and assignee pushes", () => {
  it("records an exhausted label push on the task link", async () => {
    const t = createTestContext();
    const { taskId, taskLinkId } = await setupLinkedTask(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { labels: ["bug"] });
    });

    await t.run((ctx) => maybeEnqueueLabelsPush(ctx, taskId));
    await drain(t);

    const link = await t.run(async (ctx) => await ctx.db.get(taskLinkId!));
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/exhaust/i);
  });

  it("records an exhausted assignee push on the task link", async () => {
    const t = createTestContext();
    const { workspaceId, userId, taskId, taskLinkId } = await setupLinkedTask(t);
    // The push resolves the Ripple assignee to a provider login and skips
    // entirely when there is no mapping, so the identity row is load-bearing.
    await t.run(async (ctx) => {
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId,
        provider: "github",
        externalLogin: "octocat",
      });
    });

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    await drain(t);

    const link = await t.run(async (ctx) => await ctx.db.get(taskLinkId!));
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).toMatch(/exhaust/i);
  });
});

/**
 * The two ops with no link row to mark — issue-create has not built one yet,
 * issue-close is deleting the task that owns it. Their doc comments say they
 * schedule without tracking *because* there is no `lastSyncError` to write, and
 * that much is right; what did not follow is writing nothing at all. A
 * permanent failure already reaches the workspace audit log through each op's
 * sink, so exhaustion — the same outcome by a slower route — now does too.
 */
describe("issue create and close pushes", () => {
  async function auditActions(
    t: ReturnType<typeof createTestContext>,
    resourceId: string,
  ) {
    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, { resourceType: "tasks", resourceId }),
    );
    return logs.map((l: { action: string }) => l.action);
  }

  it("records an exhausted issue-create in the audit log", async () => {
    const t = createTestContext();
    // No task link: creating the issue is what would build it.
    const { taskId, projectLinkId } = await setupLinkedTask(t, {
      withTaskLink: false,
    });

    await t.run((ctx) =>
      enqueueIssueCreate(ctx, {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        title: "New issue",
        body: "body",
      }),
    );
    await drain(t);

    expect(await auditActions(t, taskId)).toContain(
      "integration.issue_create_failed",
    );
  });

  /**
   * Keyed by issue number rather than task id, because by the time this lands
   * the task is gone — which is the whole reason the op has no link sink.
   */
  it("records an exhausted issue-close in the audit log", async () => {
    const t = createTestContext();
    const { taskId } = await setupLinkedTask(t);

    await t.run((ctx) => enqueueIssueClose(ctx, taskId));
    await drain(t);

    expect(await auditActions(t, "issue-42")).toContain(
      "integration.issue_close_failed",
    );
  });
});
