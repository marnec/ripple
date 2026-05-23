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
 * Reconnect flow: create a link, disconnect it (cascade writes
 * `tasks.externalRefFrozen` per task and tears down the link rows), then
 * re-link the same repo to the same project. Rehydration must re-create
 * `taskIntegrationLinks` rows for the previously-linked tasks, matching
 * by `externalRefFrozen.externalIssueId`, and restore `tasks.externalRefs`.
 */
async function setupDisconnectedWorkspace(
  t: ReturnType<typeof createTestContext>,
  opts: { taskCount?: number } = {},
) {
  const { taskCount = 3 } = opts;
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  // Triage status (required by createLink) + a workspaceIntegrations row.
  await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
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
      isBot: true,
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
  });

  const initialLinkId = await asUser.mutation(
    api.integrations.core.links.createLink,
    {
      projectId,
      workspaceId,
      externalAccountId: "install-1",
      externalRepoId: "R_kgDOACME",
      externalRepoFullName: "acme/web",
    },
  );

  const taskIds = await t.run(async (ctx) => {
    const status = (
      await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first()
    )!;
    const integration = (
      await ctx.db
        .query("workspaceIntegrations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .unique()
    )!;
    const ids: Id<"tasks">[] = [];
    for (let i = 0; i < taskCount; i++) {
      const issueNumber = 200 + i;
      const externalIssueId = `I_RECONNECT_${i}`;
      const taskId = await withTriggers(ctx).db.insert("tasks", {
        projectId,
        workspaceId,
        title: `existing task ${i}`,
        statusId: status._id,
        priority: "medium",
        completed: false,
        creatorId: integration.botUserId,
        externalRefs: [
          {
            provider: "github",
            repoFullName: "acme/web",
            issueNumber,
            url: `https://github.com/acme/web/issues/${issueNumber}`,
          },
        ],
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: initialLinkId,
        externalIssueId,
        externalUpdatedAt: 1_700_000_000_000 + i,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      });
      ids.push(taskId);
    }
    return ids;
  });

  // Disconnect → cascade freezes refs and tears down link rows.
  await asUser.mutation(api.integrations.core.links.unlinkLink, {
    linkId: initialLinkId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  return { workspaceId, projectId, asUser, taskIds };
}

describe("integrations/core/links.createLink — reconnect rehydration", () => {
  it("relinking the same repo to the same project rehydrates per-task link rows by frozen externalIssueId", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser, taskIds } =
      await setupDisconnectedWorkspace(t, { taskCount: 3 });

    const newLinkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-1",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The new link is sync-active.
    const link = await t.run((ctx) => ctx.db.get(newLinkId));
    expect(link?.status).toBe("active");

    // Every previously-linked task has a fresh taskIntegrationLinks row
    // pointing at the new link, with externalIssueId carried over.
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      const task = await t.run((ctx) => ctx.db.get(taskId));
      // externalRefFrozen cleared, externalRefs restored.
      expect(task!.externalRefFrozen).toBeUndefined();
      expect(task!.externalRefs).toBeDefined();
      expect(task!.externalRefs!.length).toBeGreaterThan(0);

      const newTaskLink = await t.run((ctx) =>
        ctx.db
          .query("taskIntegrationLinks")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .unique(),
      );
      expect(newTaskLink).not.toBeNull();
      expect(newTaskLink!.projectIntegrationLinkId).toBe(newLinkId);
      expect(newTaskLink!.externalIssueId).toBe(`I_RECONNECT_${i}`);
      // Author is preserved through the freeze snapshot — not reset to the
      // "github" placeholder (no later inbound event would correct it).
      expect(newTaskLink!.externalAuthor.login).toBe("octocat");
    }
  });

  it("relinking with a different externalRepoId leaves frozen tasks untouched (no false rehydration)", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, asUser, taskIds } =
      await setupDisconnectedWorkspace(t, { taskCount: 2 });

    // Same project, different repo id — should NOT match the frozen tasks.
    await asUser.mutation(api.integrations.core.links.createLink, {
      projectId,
      workspaceId,
      externalAccountId: "install-1",
      externalRepoId: "R_kgDOOTHER",
      externalRepoFullName: "acme/other",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const taskId of taskIds) {
      const task = await t.run((ctx) => ctx.db.get(taskId));
      expect(task!.externalRefFrozen).toBeDefined();
      const newTaskLink = await t.run((ctx) =>
        ctx.db
          .query("taskIntegrationLinks")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .unique(),
      );
      expect(newTaskLink).toBeNull();
    }
  });

  it("large project: reconnect drains across multiple batches without skipping any task", async () => {
    const t = createTestContext();
    // 75 > RECONNECT_BATCH_SIZE (50) → multiple drain steps required.
    const { workspaceId, projectId, asUser, taskIds } =
      await setupDisconnectedWorkspace(t, { taskCount: 75 });

    const newLinkId = await asUser.mutation(
      api.integrations.core.links.createLink,
      {
        projectId,
        workspaceId,
        externalAccountId: "install-1",
        externalRepoId: "R_kgDOACME",
        externalRepoFullName: "acme/web",
      },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const taskId of taskIds) {
      const task = await t.run((ctx) => ctx.db.get(taskId));
      expect(task!.externalRefFrozen).toBeUndefined();
      const newTaskLink = await t.run((ctx) =>
        ctx.db
          .query("taskIntegrationLinks")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .unique(),
      );
      expect(newTaskLink).not.toBeNull();
      expect(newTaskLink!.projectIntegrationLinkId).toBe(newLinkId);
    }
  });
});
