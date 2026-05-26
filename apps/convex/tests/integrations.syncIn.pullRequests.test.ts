import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import type {
  NormalizedIssueOpenedEvent,
  NormalizedPullRequestChangedEvent,
} from "../convex/integrations/core/types";
import type { Doc } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Inbound fixtures for PR tests: workspace + project + triage status + bot
 * user + workspaceIntegrations + an active projectIntegrationLinks row.
 * Mirrors the fixture in integrations.syncIn.test.ts.
 */
async function setupInboundFixtures(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { linkDoc } = await t.run(async (ctx) => {
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
      email: undefined,
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-123",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const linkDoc = (await ctx.db.get(linkId))!;
    return { linkDoc };
  });

  return {
    workspaceId,
    projectId,
    link: linkDoc as Doc<"projectIntegrationLinks">,
  };
}

const defaultAuthor = {
  login: "octocat",
  avatarUrl: "https://github.com/octocat.png",
  url: "https://github.com/octocat",
};

function makeOpenedEvent(
  overrides: Partial<NormalizedIssueOpenedEvent> = {},
): NormalizedIssueOpenedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.opened",
    externalIssueId: "I_kwDOABC123",
    issueNumber,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Dark mode crash",
    body: "repro steps",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    ...overrides,
  };
}

function makePrOpenedEvent(
  overrides: Partial<NormalizedPullRequestChangedEvent> = {},
): NormalizedPullRequestChangedEvent {
  const number = overrides.number ?? 7;
  return {
    kind: "pullRequest.changed",
    externalPrId: "PR_kwDO123",
    number,
    externalUpdatedAt: 1_700_000_005_000,
    title: "feat: fix dark mode crash",
    url: `https://github.com/acme/web/pull/${number}`,
    state: "open",
    headRef: "fix/dark-mode",
    baseRef: "main",
    externalAuthor: defaultAuthor,
    closesExternalIssueIds: ["I_kwDOABC123"],
    closesIssueNumbers: [],
    ...overrides,
  };
}

describe("integrations/core/syncInPullRequests.applyPullRequestEvent", () => {
  it("pullRequest.opened closing an imported issue creates a pullRequests row linked to that task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);

    // Import the issue first so a task with externalIssueId I_kwDOABC123 exists.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: makePrOpenedEvent(), link }),
    );

    const prs = await t.run((ctx) =>
      ctx.db
        .query("pullRequests")
        .withIndex("by_link_externalPrId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalPrId", "PR_kwDO123"),
        )
        .collect(),
    );
    expect(prs).toHaveLength(1);

    const joins = await t.run((ctx) =>
      ctx.db
        .query("taskPullRequestLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .collect(),
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]?.pullRequestId).toBe(prs[0]?._id);
  });

  it("links via parsed closesIssueNumbers when GitHub's closing graph is empty (non-default base branch)", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);

    // Imported issue #42 → a task with externalRefs.issueNumber 42.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );

    // PR merged into `develop` (non-default): GitHub returns no closing refs,
    // but "closes #42" was parsed into closesIssueNumbers.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: makePrOpenedEvent({
          baseRef: "develop",
          closesExternalIssueIds: [],
          closesIssueNumbers: [42],
        }),
        link,
      }),
    );

    const joins = await t.run((ctx) =>
      ctx.db
        .query("taskPullRequestLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .collect(),
    );
    expect(joins).toHaveLength(1);
  });

  it("a PR closing two imported issues attaches to both tasks", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalIssueId: "I_one", issueNumber: 1 }),
        link,
      }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalIssueId: "I_two", issueNumber: 2 }),
        link,
      }),
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: makePrOpenedEvent({ closesExternalIssueIds: ["I_one", "I_two"] }),
        link,
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const joins = await t.run((ctx) =>
      ctx.db.query("taskPullRequestLinks").collect(),
    );
    expect(joins).toHaveLength(2);
    expect(new Set(joins.map((j) => j.taskId))).toEqual(
      new Set(tasks.map((task) => task._id)),
    );
  });

  it("a PR closing only unimported issues is ignored — no pullRequests row created", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    // No issue.opened applied → no imported task to attach to.

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: makePrOpenedEvent({ closesExternalIssueIds: ["I_never_seen"] }),
        link,
      }),
    );

    const prs = await t.run((ctx) => ctx.db.query("pullRequests").collect());
    expect(prs).toHaveLength(0);
    const joins = await t.run((ctx) =>
      ctx.db.query("taskPullRequestLinks").collect(),
    );
    expect(joins).toHaveLength(0);
  });

  it("a redelivered pullRequest.opened (same externalPrId) does not duplicate the PR row or join", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: makePrOpenedEvent(), link }),
    );
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, { event: makePrOpenedEvent(), link }),
    );

    const prs = await t.run((ctx) => ctx.db.query("pullRequests").collect());
    expect(prs).toHaveLength(1);
    const joins = await t.run((ctx) =>
      ctx.db.query("taskPullRequestLinks").collect(),
    );
    expect(joins).toHaveLength(1);
  });

  it("stores the PR's canonical fields, preserving draft state and branches", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: makePrOpenedEvent({
          state: "draft",
          number: 99,
          headRef: "feature/x",
          baseRef: "develop",
          url: "https://github.com/acme/web/pull/99",
        }),
        link,
      }),
    );

    const [pr] = await t.run((ctx) => ctx.db.query("pullRequests").collect());
    expect(pr).toMatchObject({
      provider: "github",
      externalPrId: "PR_kwDO123",
      number: 99,
      state: "draft",
      headRef: "feature/x",
      baseRef: "develop",
      url: "https://github.com/acme/web/pull/99",
      externalUpdatedAt: 1_700_000_005_000,
      externalAuthor: defaultAuthor,
    });
  });
});
