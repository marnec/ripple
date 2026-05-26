import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { reconcileTaskStatus } from "../convex/integrations/core/statusReconciliation";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

const author = {
  login: "octocat",
  avatarUrl: "https://github.com/octocat.png",
  url: "https://github.com/octocat",
};

/**
 * Boundary tests for the `reconcileTaskStatus` arbiter — the single owner of
 * "what status should this GitHub-linked task be in". Each test pins one
 * precedence/forward-only property directly against the arbiter, independent of
 * which webhook path happens to call it.
 *
 * Statuses: Triage (0), In Progress (1, setsStartDate), In Review (2),
 * Done (3, completed). A Released (4, completed) is added by the branch-rule
 * tests so a merge can advance *past* Done.
 */
async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const ids = await t.run(async (ctx) => {
    const triageStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const startedStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Progress",
      color: "bg-blue-500",
      order: 1,
      isDefault: false,
      isCompleted: false,
      setsStartDate: true,
    });
    const inReviewStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "In Review",
      color: "bg-purple-500",
      order: 2,
      isDefault: false,
      isCompleted: false,
    });
    const doneStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-green-500",
      order: 3,
      isDefault: false,
      isCompleted: true,
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
      externalRepoId: "R_kg1",
    });
    return {
      triageStatusId,
      startedStatusId,
      inReviewStatusId,
      doneStatusId,
      link: (await ctx.db.get(linkId))! as Doc<"projectIntegrationLinks">,
    };
  });
  return { workspaceId, projectId, ...ids };
}

/** Create a triage task by importing an issue, returning its id. */
async function importIssue(
  t: ReturnType<typeof createTestContext>,
  link: Doc<"projectIntegrationLinks">,
  externalIssueId: string,
  issueNumber: number,
): Promise<Id<"tasks">> {
  await t.run((ctx) =>
    applyNormalizedEvent(ctx, {
      event: {
        kind: "issue.opened",
        externalIssueId,
        issueNumber,
        externalUpdatedAt: 1_000,
        title: `Issue ${issueNumber}`,
        body: "",
        url: `https://github.com/acme/web/issues/${issueNumber}`,
        externalAuthor: author,
      },
      link,
    }),
  );
  return t.run(async (ctx) => {
    const tl = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q
          .eq("projectIntegrationLinkId", link._id)
          .eq("externalIssueId", externalIssueId),
      )
      .unique();
    return tl!.taskId;
  });
}

/** Insert a PR row + its task join directly, returning the PR id. */
async function linkPr(
  t: ReturnType<typeof createTestContext>,
  args: {
    workspaceId: Id<"workspaces">;
    link: Doc<"projectIntegrationLinks">;
    taskId: Id<"tasks">;
    state: Doc<"pullRequests">["state"];
    baseRef?: string;
    externalPrId?: string;
  },
): Promise<Id<"pullRequests">> {
  return t.run(async (ctx) => {
    const prId = await ctx.db.insert("pullRequests", {
      workspaceId: args.workspaceId,
      projectIntegrationLinkId: args.link._id,
      provider: "github",
      externalPrId: args.externalPrId ?? "PR_1",
      number: 7,
      title: "feat: do it",
      url: "https://github.com/acme/web/pull/7",
      state: args.state,
      headRef: "fix/it",
      baseRef: args.baseRef ?? "feature/x",
      externalAuthor: author,
      externalUpdatedAt: 2_000,
    });
    await ctx.db.insert("taskPullRequestLinks", { taskId: args.taskId, pullRequestId: prId });
    return prId;
  });
}

const statusOf = (t: ReturnType<typeof createTestContext>, taskId: Id<"tasks">) =>
  t.run(async (ctx) => (await ctx.db.get(taskId))?.statusId);

describe("reconcileTaskStatus — pr.changed", () => {
  it("advances a triage task to the setsStartDate status when a PR is active (forward-only)", async () => {
    const t = createTestContext();
    const s = await setup(t);
    const taskId = await importIssue(t, s.link, "I_1", 1);
    await linkPr(t, {
      workspaceId: s.workspaceId,
      link: s.link,
      taskId,
      state: "open",
    });

    await t.run((ctx) => reconcileTaskStatus(ctx, taskId, { kind: "pr.changed" }));

    expect(await statusOf(t, taskId)).toBe(s.startedStatusId);
  });

  it("never reverts a more-advanced task (forward-only no-op)", async () => {
    const t = createTestContext();
    const s = await setup(t);
    const taskId = await importIssue(t, s.link, "I_1", 1);
    // Manually advance the task past the PR's start signal.
    await t.run((ctx) => ctx.db.patch(taskId, { statusId: s.doneStatusId }));
    await linkPr(t, {
      workspaceId: s.workspaceId,
      link: s.link,
      taskId,
      state: "open",
    });

    await t.run((ctx) => reconcileTaskStatus(ctx, taskId, { kind: "pr.changed" }));

    expect(await statusOf(t, taskId)).toBe(s.doneStatusId);
  });
});

describe("reconcileTaskStatus — issue.reopened", () => {
  it("moves a completed task back to triage unconditionally", async () => {
    const t = createTestContext();
    const s = await setup(t);
    const taskId = await importIssue(t, s.link, "I_1", 1);
    await t.run((ctx) => ctx.db.patch(taskId, { statusId: s.doneStatusId, completed: true }));

    await t.run((ctx) => reconcileTaskStatus(ctx, taskId, { kind: "issue.reopened" }));

    expect(await statusOf(t, taskId)).toBe(s.triageStatusId);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.completed).toBe(false);
  });
});

describe("reconcileTaskStatus — issue.closed", () => {
  it("moves the task to the completed status and marks it completed", async () => {
    const t = createTestContext();
    const s = await setup(t);
    const taskId = await importIssue(t, s.link, "I_1", 1);

    await t.run((ctx) =>
      reconcileTaskStatus(ctx, taskId, {
        kind: "issue.closed",
        stateReason: "completed",
      }),
    );

    expect(await statusOf(t, taskId)).toBe(s.doneStatusId);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.completed).toBe(true);
  });

  it("is suppressed when a merged PR's branch rule governs the task", async () => {
    const t = createTestContext();
    const s = await setup(t);
    // Released (order 4, completed) sits past Done so a branch rule can advance
    // beyond the generic issue-close completion.
    const releasedStatusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId: s.projectId,
        name: "Released",
        color: "bg-teal-500",
        order: 4,
        isDefault: false,
        isCompleted: true,
      }),
    );
    // Map the `release` branch → Released on the link.
    await t.run((ctx) =>
      ctx.db.patch(s.link._id, {
        branchStatusMap: [{ branch: "release", statusId: releasedStatusId }],
      }),
    );
    const taskId = await importIssue(t, s.link, "I_1", 1);
    // A merged PR into the mapped branch already advanced the task to Released.
    await t.run((ctx) => ctx.db.patch(taskId, { statusId: releasedStatusId, completed: true }));
    await linkPr(t, {
      workspaceId: s.workspaceId,
      link: s.link,
      taskId,
      state: "merged",
      baseRef: "release",
    });

    await t.run((ctx) =>
      reconcileTaskStatus(ctx, taskId, {
        kind: "issue.closed",
        stateReason: "completed",
      }),
    );

    // Branch rule wins: the task stays Released, not downgraded to Done.
    expect(await statusOf(t, taskId)).toBe(releasedStatusId);
  });
});
