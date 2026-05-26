import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import type {
  NormalizedIssueClosedEvent,
  NormalizedPullRequestChangedEvent,
} from "../convex/integrations/core/types";
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
 * Pipeline project: triage(0) → In Progress(1, setsStartDate) →
 * On Staging(2) → Released(3, completed). Link maps develop→On Staging,
 * main→Released.
 */
async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const ids = await t.run(async (ctx) => {
    const mk = (name: string, order: number, extra: object = {}) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name,
        color: "bg-gray-500",
        order,
        isDefault: false,
        isCompleted: false,
        ...extra,
      });
    const triageStatusId = await mk("Triage", 0, { isTriage: true });
    const startedStatusId = await mk("In Progress", 1, { setsStartDate: true });
    const stagingStatusId = await mk("On Staging", 2);
    // Generic completed status — the issues.closed fallback destination
    // (lowest-order isCompleted). Distinct from the branch-mapped Released.
    const doneStatusId = await mk("Done", 3, { isCompleted: true });
    const releasedStatusId = await mk("Released", 4, { isCompleted: true });
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
      branchStatusMap: [
        { branch: "develop", statusId: stagingStatusId },
        { branch: "main", statusId: releasedStatusId },
      ],
    });
    return {
      triageStatusId,
      startedStatusId,
      stagingStatusId,
      doneStatusId,
      releasedStatusId,
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

function mergeEvent(
  baseRef: string,
  overrides: Partial<NormalizedPullRequestChangedEvent> = {},
): NormalizedPullRequestChangedEvent {
  return {
    kind: "pullRequest.changed",
    externalPrId: "PR_1",
    number: 7,
    externalUpdatedAt: 5_000,
    title: "feat: x",
    url: "https://github.com/acme/web/pull/7",
    state: "merged",
    mergedAt: 5_000,
    headRef: "feature",
    baseRef,
    externalAuthor: author,
    closesExternalIssueIds: ["I_1"],
    ...overrides,
  };
}

function closedIssueEvent(
  overrides: Partial<NormalizedIssueClosedEvent> = {},
): NormalizedIssueClosedEvent {
  return {
    kind: "issue.closed",
    externalIssueId: "I_1",
    issueNumber: 1,
    externalUpdatedAt: 6_000,
    title: "Issue 1",
    body: "",
    url: "https://github.com/acme/web/issues/1",
    externalAuthor: author,
    stateReason: "completed",
    ...overrides,
  };
}

async function statusOf(
  t: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
) {
  return (await t.run((ctx) => ctx.db.get(taskId)))?.statusId;
}

describe("integrations PR branch→status automation", () => {
  it("merging into a mapped branch moves the task to the mapped status", async () => {
    const t = createTestContext();
    const { link, stagingStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: mergeEvent("develop"), link }),
    );

    expect(await statusOf(t, taskId)).toBe(stagingStatusId);
  });

  it("merging into an unmapped branch produces no branch-driven move", async () => {
    const t = createTestContext();
    const { link, triageStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: mergeEvent("feature-x"), link }),
    );

    expect(await statusOf(t, taskId)).toBe(triageStatusId);
  });

  it("advances forward across a dev→staging→prod pipeline, never backward", async () => {
    const t = createTestContext();
    const { link, stagingStatusId, releasedStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    // Merge to develop → On Staging.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: mergeEvent("develop", { externalPrId: "PR_dev" }),
        link,
      }),
    );
    expect(await statusOf(t, taskId)).toBe(stagingStatusId);

    // Merge to main → Released.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: mergeEvent("main", {
          externalPrId: "PR_main",
          number: 8,
          url: "https://github.com/acme/web/pull/8",
        }),
        link,
      }),
    );
    expect(await statusOf(t, taskId)).toBe(releasedStatusId);

    // Later hotfix merged to develop → must NOT pull Released back to Staging.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: mergeEvent("develop", {
          externalPrId: "PR_hotfix",
          number: 9,
          url: "https://github.com/acme/web/pull/9",
          externalUpdatedAt: 7_000,
        }),
        link,
      }),
    );
    expect(await statusOf(t, taskId)).toBe(releasedStatusId);
  });

  it("rule wins: issues.closed does not override a matched branch rule (merge first)", async () => {
    const t = createTestContext();
    const { link, releasedStatusId, doneStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    // Merge to main → Released (the mapped, higher-order completed status).
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: mergeEvent("main"), link }),
    );
    expect(await statusOf(t, taskId)).toBe(releasedStatusId);

    // GitHub auto-closes the issue → issues.closed must NOT pull it to Done.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: closedIssueEvent(), link }),
    );

    expect(await statusOf(t, taskId)).toBe(releasedStatusId);
    expect(await statusOf(t, taskId)).not.toBe(doneStatusId);
  });

  it("fallback: issues.closed completes the task when no branch rule matched", async () => {
    const t = createTestContext();
    const { link, doneStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    // Merge into an unmapped branch (no rule) then the issue closes.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: mergeEvent("feature-x"), link }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: closedIssueEvent(), link }),
    );

    expect(await statusOf(t, taskId)).toBe(doneStatusId);
  });

  it("converges to the mapped status regardless of webhook order (closed first)", async () => {
    const t = createTestContext();
    const { link, releasedStatusId } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    // issues.closed arrives first (no merged PR yet) → generic completion.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: closedIssueEvent(), link }),
    );
    // Then the merge into main is processed → advances to Released.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: mergeEvent("main", { externalUpdatedAt: 7_000 }),
        link,
      }),
    );

    expect(await statusOf(t, taskId)).toBe(releasedStatusId);
  });

  it("a merge into a branch mapped to a completed status marks the task completed", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    const taskId = await importIssue(t, link, "I_1", 1);

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: mergeEvent("main"), link }),
    );

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.completed).toBe(true);
  });
});
