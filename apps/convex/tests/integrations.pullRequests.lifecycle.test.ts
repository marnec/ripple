import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import type { NormalizedPullRequestChangedEvent } from "../convex/integrations/core/types";
import type { Doc } from "../convex/_generated/dataModel";
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

async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  const { link } = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
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
    return { link: (await ctx.db.get(linkId))! as Doc<"projectIntegrationLinks"> };
  });
  return { workspaceId, projectId, link, asUser };
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

async function getPr(t: ReturnType<typeof createTestContext>) {
  const [pr] = await t.run((ctx) => ctx.db.query("pullRequests").collect());
  return pr;
}

describe("integrations PR lifecycle", () => {
  it("a merge updates the PR to state 'merged' and records mergedAt", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({
          state: "merged",
          mergedAt: 3_500,
          externalUpdatedAt: 3_000,
        }),
        link,
      }),
    );

    const pr = await getPr(t);
    expect(pr?.state).toBe("merged");
    expect(pr?.mergedAt).toBe(3_500);
  });

  it("a close-without-merge sets state 'closed' but keeps the attachment", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "closed", externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    const pr = await getPr(t);
    expect(pr?.state).toBe("closed");
    const joins = await t.run((ctx) =>
      ctx.db.query("taskPullRequestLinks").collect(),
    );
    expect(joins).toHaveLength(1);
  });

  it("reopen and draft toggles update the PR state", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "draft", externalUpdatedAt: 3_000 }),
        link,
      }),
    );
    expect((await getPr(t))?.state).toBe("draft");

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "open", externalUpdatedAt: 4_000 }),
        link,
      }),
    );
    expect((await getPr(t))?.state).toBe("open");
  });

  it("an edit that adds a 'Closes #N' attaches the newly-referenced task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await importIssue(t, link, "I_2", 2);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    // Edited: now closes both issues.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({
          closesExternalIssueIds: ["I_1", "I_2"],
          externalUpdatedAt: 3_000,
        }),
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

  it("an edit that removes a 'Closes #N' detaches that task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await importIssue(t, link, "I_2", 2);
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ closesExternalIssueIds: ["I_1", "I_2"] }),
        link,
      }),
    );

    // Edited: now closes only I_1.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({
          closesExternalIssueIds: ["I_1"],
          externalUpdatedAt: 3_000,
        }),
        link,
      }),
    );

    const task1 = await t.run(async (ctx) => {
      const link1 = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q.eq("projectIntegrationLinkId", link._id).eq("externalIssueId", "I_1"),
        )
        .unique();
      return link1!.taskId;
    });
    const joins = await t.run((ctx) =>
      ctx.db.query("taskPullRequestLinks").collect(),
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]?.taskId).toBe(task1);
    expect(projectId).toBeDefined();
  });

  it("drops a stale (older) event without changing state", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "open", externalUpdatedAt: 5_000 }),
        link,
      }),
    );

    // Stale delivery: older timestamp, claims merged — must be ignored.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "merged", externalUpdatedAt: 4_000 }),
        link,
      }),
    );

    expect((await getPr(t))?.state).toBe("open");
  });
});

describe("integrations PR denormalized tasks.pullRequestState", () => {
  async function taskFor(
    t: ReturnType<typeof createTestContext>,
    link: Doc<"projectIntegrationLinks">,
    externalIssueId: string,
  ) {
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

  it("reflects the linked PR's state on the task, advancing on merge", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.pullRequestState).toBe(
      "open",
    );

    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ state: "merged", externalUpdatedAt: 3_000 }),
        link,
      }),
    );
    expect((await t.run((ctx) => ctx.db.get(taskId)))?.pullRequestState).toBe(
      "merged",
    );
  });

  it("picks the most-advanced state across multiple linked PRs", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

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

    expect((await t.run((ctx) => ctx.db.get(taskId)))?.pullRequestState).toBe(
      "merged",
    );
  });

  it("clears the field when the task's last PR detaches", async () => {
    const t = createTestContext();
    const { link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const taskId = await taskFor(t, link, "I_1");

    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));
    // Edit removes the closing reference → task detached.
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: prEvent({ closesExternalIssueIds: [], externalUpdatedAt: 3_000 }),
        link,
      }),
    );

    expect(
      (await t.run((ctx) => ctx.db.get(taskId)))?.pullRequestState,
    ).toBeUndefined();
  });
});

describe("integrations PR cascade", () => {
  it("deleting a task detaches its taskPullRequestLinks", async () => {
    const t = createTestContext();
    const { link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    await t.run((ctx) => applyPullRequestEvent(ctx, { event: prEvent(), link }));

    const taskId = await t.run(async (ctx) => {
      const tl = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q.eq("projectIntegrationLinkId", link._id).eq("externalIssueId", "I_1"),
        )
        .unique();
      return tl!.taskId;
    });

    expect(
      await t.run((ctx) => ctx.db.query("taskPullRequestLinks").collect()),
    ).toHaveLength(1);

    await asUser.mutation(api.tasks.remove, { taskId });

    expect(
      await t.run((ctx) => ctx.db.query("taskPullRequestLinks").collect()),
    ).toHaveLength(0);
  });
});
