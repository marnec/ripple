import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Doc, Id } from "../convex/_generated/dataModel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Build a workspace + project + active link + N linked tasks (each with
 * one comment-link row). The disconnect cascade has to:
 *   - write a `tasks.externalRefFrozen` snapshot per task
 *   - delete every `taskCommentIntegrationLinks` row pointing at the task link
 *   - delete every `taskIntegrationLinks` row for the project link
 * Tasks themselves must survive.
 */
async function setupLinkedWorkspace(
  t: ReturnType<typeof createTestContext>,
  opts: { taskCount?: number } = {},
) {
  const { taskCount = 3 } = opts;
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { linkId, taskIds, taskLinkIds, commentLinkIds } = await t.run(
    async (ctx) => {
      const triageStatusId = await ctx.db.insert("taskStatuses", {
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
      const linkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      });

      const taskIds: Id<"tasks">[] = [];
      const taskLinkIds: Id<"taskIntegrationLinks">[] = [];
      const commentLinkIds: Id<"taskCommentIntegrationLinks">[] = [];

      for (let i = 0; i < taskCount; i++) {
        const issueNumber = 100 + i;
        const externalIssueId = `I_kwDOABC${i}`;
        const url = `https://github.com/acme/web/issues/${issueNumber}`;
        const taskId = await ctx.db.insert("tasks", {
          projectId,
          workspaceId,
          title: `task ${i}`,
          statusId: i % 2 === 0 ? triageStatusId : todoStatusId,
          priority: "medium",
          completed: false,
          creatorId: botUserId,
          externalRefs: [
            {
              provider: "github",
              repoFullName: "acme/web",
              issueNumber,
              url,
            },
          ],
        });
        const taskLinkId = await ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: linkId,
          externalIssueId,
          externalUpdatedAt: 1_700_000_000_000 + i,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://github.com/octocat.png",
            url: "https://github.com/octocat",
          },
        });
        const commentId = await ctx.db.insert("taskComments", {
          taskId,
          userId: botUserId,
          body: "external comment",
          deleted: false,
        });
        const commentLinkId = await ctx.db.insert(
          "taskCommentIntegrationLinks",
          {
            taskCommentId: commentId,
            taskIntegrationLinkId: taskLinkId,
            externalCommentId: `IC_${i}`,
            externalUpdatedAt: 1_700_000_001_000 + i,
            externalAuthor: {
              login: "octocat",
              avatarUrl: "https://github.com/octocat.png",
              url: "https://github.com/octocat",
            },
          },
        );

        taskIds.push(taskId);
        taskLinkIds.push(taskLinkId);
        commentLinkIds.push(commentLinkId);
      }

      return { linkId, taskIds, taskLinkIds, commentLinkIds };
    },
  );

  return { workspaceId, projectId, asUser, linkId, taskIds, taskLinkIds, commentLinkIds };
}

async function readTasks(
  t: ReturnType<typeof createTestContext>,
  taskIds: Id<"tasks">[],
): Promise<(Doc<"tasks"> | null)[]> {
  return t.run(async (ctx) => Promise.all(taskIds.map((id) => ctx.db.get(id))));
}

describe("integrations/core/links.unlinkLink — disconnect cascade", () => {
  it("happy path: small workspace → status disconnected, all task links + comment links removed, frozen refs written, tasks survive", async () => {
    const t = createTestContext();
    const { asUser, linkId, taskIds, taskLinkIds, commentLinkIds } =
      await setupLinkedWorkspace(t, { taskCount: 3 });

    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Link status flipped immediately.
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");

    // Every per-task link is gone.
    for (const tlId of taskLinkIds) {
      const row = await t.run((ctx) => ctx.db.get(tlId));
      expect(row).toBeNull();
    }
    // Every per-comment link is gone.
    for (const clId of commentLinkIds) {
      const row = await t.run((ctx) => ctx.db.get(clId));
      expect(row).toBeNull();
    }

    // Tasks survive AND carry a frozen ref.
    const tasks = await readTasks(t, taskIds);
    expect(tasks.every((t) => t !== null)).toBe(true);
    for (const task of tasks) {
      expect(task!.externalRefFrozen).toBeDefined();
      expect(task!.externalRefFrozen!.provider).toBe("github");
      expect(task!.externalRefFrozen!.repoFullName).toBe("acme/web");
      expect(typeof task!.externalRefFrozen!.externalIssueId).toBe("string");
      expect(typeof task!.externalRefFrozen!.disconnectedAt).toBe("number");
    }
  });

  it("workspace large enough to exceed one batch → drain reschedules itself until done", async () => {
    const t = createTestContext();
    // 75 > DISCONNECT_BATCH_SIZE (50) → at least two drain steps required.
    const { asUser, linkId, taskLinkIds, taskIds } =
      await setupLinkedWorkspace(t, { taskCount: 75 });

    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const tlId of taskLinkIds) {
      const row = await t.run((ctx) => ctx.db.get(tlId));
      expect(row).toBeNull();
    }
    const tasks = await readTasks(t, taskIds);
    for (const task of tasks) {
      expect(task!.externalRefFrozen).toBeDefined();
    }
  });

  it("per-batch mutation is idempotent: rerunning with the same link id finishes cleanly when nothing remains", async () => {
    const t = createTestContext();
    const { asUser, linkId, taskLinkIds, taskIds } = await setupLinkedWorkspace(
      t,
      { taskCount: 2 },
    );
    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Calling the per-batch mutation again after cascade completion is a no-op.
    await t.mutation(
      internal.integrations.core.links.drainDisconnectBatch,
      { projectIntegrationLinkId: linkId },
    );

    for (const tlId of taskLinkIds) {
      expect(await t.run((ctx) => ctx.db.get(tlId))).toBeNull();
    }
    const tasks = await readTasks(t, taskIds);
    for (const task of tasks) {
      expect(task!.externalRefFrozen).toBeDefined();
    }
  });

  it("Ripple-native tasks in the same project are untouched", async () => {
    const t = createTestContext();
    const { asUser, linkId, projectId } = await setupLinkedWorkspace(t, {
      taskCount: 2,
    });
    // Insert a Ripple-native task with no externalRefs.
    const rippleTaskId = await t.run(async (ctx) => {
      const status = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
      const link = await ctx.db.get(linkId);
      const integration = await ctx.db
        .query("workspaceIntegrations")
        .withIndex("by_workspace", (q) =>
          q.eq("workspaceId", link!.workspaceId),
        )
        .unique();
      return ctx.db.insert("tasks", {
        projectId,
        workspaceId: link!.workspaceId,
        title: "ripple-native",
        statusId: status!._id,
        priority: "medium",
        completed: false,
        creatorId: integration!.botUserId,
      });
    });

    await asUser.mutation(api.integrations.core.links.unlinkLink, { linkId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const native = await t.run((ctx) => ctx.db.get(rippleTaskId));
    expect(native).not.toBeNull();
    expect(native!.externalRefFrozen).toBeUndefined();
  });
});

describe("auto-disconnect via installation events triggers the same cascade", () => {
  it("installation.deleted → all of the workspace's links → status disconnected + freeze cascade runs", async () => {
    const t = createTestContext();
    const { linkId, taskIds, taskLinkIds } = await setupLinkedWorkspace(t, {
      taskCount: 3,
    });

    await t.mutation(
      internal.integrations.github.webhook.handleGithubWebhookMutation,
      {
        eventName: "installation",
        payload: {
          action: "deleted",
          installation: { id: "install-1" },
        },
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");
    for (const tlId of taskLinkIds) {
      expect(await t.run((ctx) => ctx.db.get(tlId))).toBeNull();
    }
    const tasks = await readTasks(t, taskIds);
    for (const task of tasks) {
      expect(task!.externalRefFrozen).toBeDefined();
    }
  });

  it("installation.deleted re-delivery is idempotent: links stay disconnected, frozen refs unchanged, no resurrection", async () => {
    const t = createTestContext();
    const { linkId, taskIds, taskLinkIds } = await setupLinkedWorkspace(t, {
      taskCount: 3,
    });

    const fire = () =>
      t.mutation(
        internal.integrations.github.webhook.handleGithubWebhookMutation,
        {
          eventName: "installation",
          payload: { action: "deleted", installation: { id: "install-1" } },
        },
      );

    await fire();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Snapshot the frozen refs the first cascade wrote.
    const firstFreeze = (await readTasks(t, taskIds)).map(
      (tk) => tk!.externalRefFrozen,
    );
    expect(firstFreeze.every((f) => f !== undefined)).toBe(true);

    // GitHub re-delivers the same event within its retry window. The status
    // guard short-circuits before scheduling a second cascade.
    await fire();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");
    // Task links stay deleted — the second pass resurrects nothing.
    for (const tlId of taskLinkIds) {
      expect(await t.run((ctx) => ctx.db.get(tlId))).toBeNull();
    }
    // Frozen refs are exactly what the first cascade wrote — no re-freeze or
    // duplicated work on the redelivery.
    const secondFreeze = (await readTasks(t, taskIds)).map(
      (tk) => tk!.externalRefFrozen,
    );
    expect(secondFreeze).toEqual(firstFreeze);
  });

  it("installation_repositories.removed → only listed repos disconnect + cascade", async () => {
    const t = createTestContext();
    const { linkId, taskIds, taskLinkIds } = await setupLinkedWorkspace(t, {
      taskCount: 2,
    });

    await t.mutation(
      internal.integrations.github.webhook.handleGithubWebhookMutation,
      {
        eventName: "installation_repositories",
        payload: {
          action: "removed",
          installation: { id: "install-1" },
          repositories_removed: [
            { node_id: "R_kgDOACME", full_name: "acme/web" },
          ],
        },
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");
    for (const tlId of taskLinkIds) {
      expect(await t.run((ctx) => ctx.db.get(tlId))).toBeNull();
    }
    const tasks = await readTasks(t, taskIds);
    for (const task of tasks) {
      expect(task!.externalRefFrozen).toBeDefined();
    }
  });
});

void WorkspaceRole;
