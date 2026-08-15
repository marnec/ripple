import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGithubWebhook } from "../convex/integrations/github/webhook";
import {
  handlePullRequestWebhook,
  normalizePullRequestPayload,
} from "../convex/integrations/github/pullRequestWebhook";
import { api, internal } from "../convex/_generated/api";
import { REPO_RENAME_BATCH_SIZE } from "../convex/integrations/core/links";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Renaming (or transferring) a linked repository is an ordinary admin event
 * that Ripple absorbs silently: the link resolves on the stable provider-side
 * repo id, and `resolveInboundLink` refreshes `externalRepoFullName` in place.
 *
 * But the repo path is denormalized onto every linked task — `tasks.externalRefs[]`
 * and its `taskExternalRefs` lookup projection, both written once at link time
 * — while the two readers key on the link's CURRENT name. So a rename used to
 * leave every pre-rename task's mirror pointing at a name nothing looks up
 * again, and two features silently stopped working for exactly those tasks:
 *
 *  - `Closes #N` keyword linking (`resolveTaskIds`' number path), which is the
 *    ONLY signal that attaches a PR to a task when the PR targets a non-default
 *    base branch — so branch→status automation stopped advancing them on merge;
 *  - "Create branch" (`branchCreateContext`), which returned null.
 *
 * New tasks kept working, so the breakage looked random. These tests drive the
 * real webhook entry points and assert both features survive a rename.
 */
const OLD_NAME = "acme/old-name";
const NEW_NAME = "acme/new-name";
const REPO_ID = "R_kgDOACME";
const INSTALLATION_ID = "999111";

function issuePayload(args: {
  repoFullName: string;
  issueNumber: number;
  nodeId: string;
}) {
  return {
    action: "opened",
    issue: {
      id: 10_000 + args.issueNumber,
      node_id: args.nodeId,
      number: args.issueNumber,
      title: `Issue ${args.issueNumber}`,
      body: "",
      state: "open",
      html_url: `https://github.com/${args.repoFullName}/issues/${args.issueNumber}`,
      updated_at: "2026-05-15T10:00:00Z",
      user: {
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        html_url: "https://github.com/octocat",
      },
    },
    installation: { id: Number(INSTALLATION_ID) },
    repository: { node_id: REPO_ID, full_name: args.repoFullName },
  };
}

/**
 * A PR that closes an issue by keyword and targets a NON-default base branch —
 * the case where GitHub's own closing graph resolves nothing, so the number
 * path through `taskExternalRefs` is the only link between PR and task.
 */
function closingPrPayload(args: { repoFullName: string; issueNumber: number }) {
  return {
    action: "opened",
    pull_request: {
      node_id: "PR_kwDO123",
      number: 7,
      title: "feat: the work",
      body: `Closes #${args.issueNumber}`,
      html_url: `https://github.com/${args.repoFullName}/pull/7`,
      draft: false,
      updated_at: "2026-05-20T10:00:00Z",
      head: { ref: "some-branch" },
      base: { ref: "develop" },
      user: {
        login: "octocat",
        avatar_url: "https://github.com/octocat.png",
        html_url: "https://github.com/octocat",
      },
    },
    installation: { id: Number(INSTALLATION_ID) },
    repository: {
      node_id: REPO_ID,
      full_name: args.repoFullName,
      owner: { login: "acme" },
      name: args.repoFullName.split("/")[1],
    },
  };
}

async function setupLinkedRepo(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const linkId = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub" });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: INSTALLATION_ID,
    });
    return await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: OLD_NAME,
      externalRepoId: REPO_ID,
    });
  });
  return { workspaceId, projectId, linkId, asUser };
}

describe("a linked repo is renamed on the provider side", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Import issue #42 under the old name, then deliver anything at all carrying
   * the new one — the rename is absorbed by whatever delivery arrives first.
   */
  async function importThenRename(t: ReturnType<typeof createTestContext>) {
    const seeded = await setupLinkedRepo(t);

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: issuePayload({
          repoFullName: OLD_NAME,
          issueNumber: 42,
          nodeId: "I_kwDOABC42",
        }),
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: issuePayload({
          repoFullName: NEW_NAME,
          issueNumber: 43,
          nodeId: "I_kwDOABC43",
        }),
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(seeded.linkId));
    expect(link?.externalRepoFullName).toBe(NEW_NAME);

    const taskId = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", seeded.projectId))
        .collect();
      return tasks.find((tk) => tk.externalRefs?.[0]?.issueNumber === 42)!._id;
    });

    return { ...seeded, taskId };
  }

  it("still links a `Closes #N` pull request to a task imported before the rename", async () => {
    const t = createTestContext();
    const { taskId } = await importThenRename(t);

    // The PR arrives under the new name, closes #42 by keyword, and targets
    // `develop` — so `closesExternalIssueIds` is empty and the number path is
    // the only thing that can find the task.
    const event = normalizePullRequestPayload(
      "pull_request",
      closingPrPayload({ repoFullName: NEW_NAME, issueNumber: 42 }),
      [],
    )!;
    await t.run((ctx) =>
      handlePullRequestWebhook(ctx, {
        event,
        externalAccountId: INSTALLATION_ID,
        externalRepoId: REPO_ID,
        repoFullName: NEW_NAME,
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const joins = await t.run((ctx) =>
      ctx.db
        .query("taskPullRequestLinks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(joins).toHaveLength(1);
  });

  it("still resolves a branch-create context for a task imported before the rename", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await importThenRename(t);

    const ctx = await asUser.query(
      internal.integrations.github.branchesAction.branchCreateContext,
      { taskId },
    );

    // Non-null is the whole assertion the "Create branch" button depends on —
    // it matches the task's ref against the link's current name and gives up
    // silently when they disagree.
    expect(ctx).not.toBeNull();
    expect(ctx).toMatchObject({ owner: "acme", repo: "new-name", issueNumber: 42 });
  });

  it("shows the new repo path on the task rather than the old one forever", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await importThenRename(t);

    const task = await asUser.query(api.tasks.get, { taskId });

    expect(task?.externalRefs?.[0]?.repoFullName).toBe(NEW_NAME);
  });

  /**
   * A project can carry far more linked tasks than one mutation may rewrite, so
   * the drain re-takes the head of the old-name range and reschedules. That
   * only terminates if every step shrinks the range — an off-by-one there is
   * either a hang or a silently half-renamed project.
   */
  it("finishes a project with more linked tasks than fit in one batch", async () => {
    const t = createTestContext();
    const { projectId, workspaceId, linkId } = await setupLinkedRepo(t);
    const total = REPO_RENAME_BATCH_SIZE * 2 + 3;

    await t.run(async (ctx) => {
      const status = await ctx.db
        .query("taskStatuses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .first();
      const creator = await ctx.db.query("users").first();
      for (let i = 1; i <= total; i++) {
        const taskId = await ctx.db.insert("tasks", {
          projectId,
          workspaceId,
          title: `Task ${i}`,
          statusId: status!._id,
          priority: "medium",
          completed: false,
          creatorId: creator!._id,
          externalRefs: [
            {
              provider: "github",
              repoFullName: OLD_NAME,
              issueNumber: i,
              url: `https://github.com/${OLD_NAME}/issues/${i}`,
            },
          ],
        });
        await ctx.db.insert("taskExternalRefs", {
          taskId,
          projectId,
          repoFullName: OLD_NAME,
          issueNumber: i,
        });
      }
      await ctx.db.patch(linkId, { externalRepoFullName: NEW_NAME });
    });

    await t.mutation(internal.integrations.core.links.drainRepoRenameBatch, {
      projectId,
      from: OLD_NAME,
      to: NEW_NAME,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("taskExternalRefs")
        .withIndex("by_project_repo_issue", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.repoFullName === NEW_NAME)).toBe(true);

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(
      tasks.every((tk) => tk.externalRefs?.[0]?.repoFullName === NEW_NAME),
    ).toBe(true);
  });
});
