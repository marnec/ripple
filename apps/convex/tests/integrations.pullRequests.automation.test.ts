import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import type { NormalizedPullRequestChangedEvent } from "../convex/integrations/core/types";
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
 * Project with a triage (order 0), an In Progress (order 1, setsStartDate),
 * and a Done (order 2, completed) status — enough to exercise forward-only.
 */
async function setup(
  t: ReturnType<typeof createTestContext>,
  opts: { withStarted?: boolean } = { withStarted: true },
) {
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
    let startedStatusId: Id<"taskStatuses"> | undefined;
    if (opts.withStarted) {
      startedStatusId = await ctx.db.insert("taskStatuses", {
        projectId,
        name: "In Progress",
        color: "bg-blue-500",
        order: 1,
        isDefault: false,
        isCompleted: false,
        setsStartDate: true,
      });
    }
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

async function importIssue(
  t: ReturnType<typeof createTestContext>,
  link: Doc<"projectIntegrationLinks">,
  externalIssueId: string,
  issueNumber: number,
) {
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

function prEvent(
  overrides: Partial<NormalizedPullRequestChangedEvent> = {},
): NormalizedPullRequestChangedEvent {
  return {
    kind: "pullRequest.changed",
    externalPrId: "PR_1",
    number: 7,
    externalUpdatedAt: 2_000,
    title: "feat: fix it",
    url: "https://github.com/acme/web/pull/7",
    state: "open",
    headRef: "fix/it",
    baseRef: "main",
    externalAuthor: author,
    closesExternalIssueIds: ["I_1"],
    ...overrides,
  };
}

describe("integrations PR status automation", () => {
  it("opening a PR moves a triage task to the setsStartDate status and opens a work period", async () => {
    const t = createTestContext();
    const { link, triageStatusId, startedStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      triageStatusId,
    );

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.statusId).toBe(startedStatusId);
    expect(task?.completed).toBe(false);
    expect(task?.workPeriods?.some((p) => p.completedAt === undefined)).toBe(true);
  });

  it("forward-only: a task already past the start status is not pulled back", async () => {
    const t = createTestContext();
    const { link, inReviewStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => ctx.db.patch(taskId, { statusId: inReviewStatusId }));

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      inReviewStatusId,
    );
  });

  it("never touches a completed task", async () => {
    const t = createTestContext();
    const { link, doneStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);
    await t.run((ctx) =>
      ctx.db.patch(taskId, { statusId: doneStatusId, completed: true }),
    );

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      doneStatusId,
    );
  });

  it("no setsStartDate status in the project → clean no-op", async () => {
    const t = createTestContext();
    const { link, triageStatusId } = await setup(t, { withStarted: false });
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      triageStatusId,
    );
  });

  it("multi-PR: an open PR alongside a merged one still nominates started, stably", async () => {
    const t = createTestContext();
    const { link, startedStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ externalPrId: "PR_a", state: "merged", mergedAt: 9 }),
        link,
      }),
    );
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({
          externalPrId: "PR_b",
          number: 8,
          url: "https://github.com/acme/web/pull/8",
          state: "open",
        }),
        link,
      }),
    );

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      startedStatusId,
    );
  });

  it("does not revert a started task when its PR later closes unmerged", async () => {
    const t = createTestContext();
    const { link, startedStatusId, triageStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      startedStatusId,
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "closed", externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.statusId).toBe(startedStatusId);
    expect(task?.statusId).not.toBe(triageStatusId);
  });

  it("does not downgrade a manually-advanced task on a draft toggle", async () => {
    const t = createTestContext();
    const { link, inReviewStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    // Reviewer/human advances it past started.
    await t.run((ctx) => ctx.db.patch(taskId, { statusId: inReviewStatusId }));

    // PR flips to draft — must not pull the task back to started.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "draft", externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.statusId).toBe(
      inReviewStatusId,
    );
  });
});
