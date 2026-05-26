import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { applyPullRequestEvent } from "../convex/integrations/core/syncInPullRequests";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Doc } from "../convex/_generated/dataModel";

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

describe("integrations/core/pullRequestLinks.listByTask", () => {
  it("returns [] for a task with no linked PRs", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );

    const result = await asUser.query(
      api.integrations.core.pullRequestLinks.listByTask,
      { taskId: task!._id },
    );
    expect(result).toEqual([]);
  });

  it("returns the attached PR's display fields", async () => {
    const t = createTestContext();
    const { projectId, link, asUser } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    await t.run((ctx) =>
      applyPullRequestEvent(ctx, {
        event: {
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
        },
        link,
      }),
    );

    const result = await asUser.query(
      api.integrations.core.pullRequestLinks.listByTask,
      { taskId: task!._id },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      number: 7,
      title: "feat: fix it",
      url: "https://github.com/acme/web/pull/7",
      state: "open",
      headRef: "fix/it",
      baseRef: "main",
    });
  });

  it("returns empty for non-workspace members (soft gate, no data leak)", async () => {
    const t = createTestContext();
    const { projectId, link } = await setup(t);
    await importIssue(t, link, "I_1", 1);
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const outsider = t.withIdentity({
      subject: "stranger|test-session",
      issuer: "test",
    });

    expect(
      await outsider.query(api.integrations.core.pullRequestLinks.listByTask, {
        taskId: task!._id,
      }),
    ).toEqual([]);
  });
});
