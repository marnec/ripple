import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * GitLab's force-resync adapter — the row that makes `core/resyncAdapters`
 * more than a redirect. It mirrors `github/forceResyncAction`: fetch each
 * linked issue's current provider truth, then hand it to the shared
 * `core/forceResync.applyOneIssueReconciliation`, so every reconciliation rule
 * (forward-only status, label naming, assignee matching) stays in core.
 *
 * GitLab specifics proven here: the project is addressed by its stable numeric
 * id (not `path_with_namespace`, which renames), `state` is `opened`/`closed`,
 * `labels` is a plain string array, and assignees carry the numeric `id` the
 * GitLab identity path matches on.
 */

/** A GitLab REST issue as `GET /projects/:id/issues/:iid` returns it. */
function gitlabIssue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 301,
    iid: 23,
    state: "opened",
    title: "Page crashes on dark mode",
    description: "repro steps",
    web_url: "https://gitlab.com/acme/web/-/issues/23",
    updated_at: "2026-05-20T10:00:00Z",
    author: {
      id: 7,
      username: "octocat",
      avatar_url: "https://gitlab.com/octocat.png",
      web_url: "https://gitlab.com/octocat",
    },
    labels: [],
    assignees: [],
    ...overrides,
  };
}

async function setupGitlabLinkedTask(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });
  return t.run(async (ctx) => {
    const botUserId = await ctx.db.insert("users", {
      name: "GitLab",
      isBot: true,
    });
    const integrationId = await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "gitlab",
      externalAccountId: "gl-acct",
      credentialToken: "glpat-xxx",
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Done",
      color: "bg-emerald-500",
      order: 1,
      isDefault: false,
      isCompleted: true,
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      workspaceIntegrationId: integrationId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "42",
      webhookSecret: "s3cr3t",
    });
    const taskId = await withTriggers(ctx).db.insert("tasks", {
      projectId,
      workspaceId,
      title: "Page crashes on dark mode",
      statusId: todoId,
      priority: "medium",
      completed: false,
      creatorId: botUserId,
      externalRefs: [
        {
          provider: "gitlab",
          repoFullName: "acme/web",
          issueNumber: 23,
          url: "https://gitlab.com/acme/web/-/issues/23",
        },
      ],
    });
    await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: linkId,
      externalIssueId: "301",
      externalState: "open",
      externalUpdatedAt: 1_000,
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://gitlab.com/octocat.png",
        url: "https://gitlab.com/octocat",
      },
    });
    return { linkId, taskId, projectId, workspaceId };
  });
}

/** Stub fetch, recording the URLs asked for, answering with `body`. */
function stubGitlabApi(body: Record<string, unknown>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return urls;
}

describe("integrations/gitlab/forceResyncAction.runForceResync", () => {
  it("completes a Ripple task whose GitLab issue is closed, fetching GitLab's API by project id", async () => {
    const t = createTestContext();
    const { linkId, taskId } = await setupGitlabLinkedTask(t);
    const urls = stubGitlabApi(gitlabIssue({ state: "closed" }));

    await t.action(
      internal.integrations.gitlab.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.completed).toBe(true);
    expect(urls).toEqual(["https://gitlab.com/api/v4/projects/42/issues/23"]);
  });

  /**
   * GitLab addresses members by numeric id, so the synthesized
   * `issue.assignees_changed` must carry `id` — with only a login the resync
   * can never match a member and assignee drift would silently never converge.
   */
  it("assigns the Ripple member behind a GitLab assignee's numeric id", async () => {
    const t = createTestContext();
    const { linkId, taskId, workspaceId } = await setupGitlabLinkedTask(t);
    const memberId = await t.run(async (ctx) => {
      const memberId = await ctx.db.insert("users", {
        name: "Dana",
        gitlabUserId: "99",
        gitlabLogin: "dana",
      });
      await ctx.db.insert("workspaceMembers", {
        userId: memberId,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      return memberId;
    });
    stubGitlabApi(
      gitlabIssue({
        assignees: [
          {
            id: 99,
            username: "dana",
            avatar_url: "https://gitlab.com/dana.png",
            web_url: "https://gitlab.com/dana",
          },
        ],
      }),
    );

    await t.action(
      internal.integrations.gitlab.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.assigneeId).toBe(memberId);
  });

  it("does nothing when the integration has no stored credential", async () => {
    const t = createTestContext();
    const { linkId, taskId } = await setupGitlabLinkedTask(t);
    await t.run(async (ctx) => {
      const integration = await ctx.db
        .query("workspaceIntegrations")
        .withIndex("by_externalAccount", (q) =>
          q.eq("externalAccountId", "gl-acct"),
        )
        .unique();
      await ctx.db.patch(integration!._id, { credentialToken: undefined });
    });
    const urls = stubGitlabApi(gitlabIssue({ state: "closed" }));

    await t.action(
      internal.integrations.gitlab.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(urls).toEqual([]);
    const task = await t.run((ctx) => ctx.db.get(taskId as Id<"tasks">));
    expect(task?.completed).toBe(false);
  });
});
