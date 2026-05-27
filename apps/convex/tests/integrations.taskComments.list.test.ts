import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { api } from "../convex/_generated/api";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { NormalizedCommentCreatedEvent } from "../convex/integrations/core/types";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";

/**
 * Set up a project + task + integration link, returning the bound test
 * context and a created task id. Caller becomes a workspace admin and the
 * task assignee so `requireResourceMember` lets them read comments.
 */
async function setupTaskWithLink(t: ReturnType<typeof createTestContext>) {
  const { userId, asUser } = await setupAuthenticatedUser(t);
  const workspaceId = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", {
      name: "WS",
      ownerId: userId,
    });
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { taskId, link } = await t.run(async (ctx) => {
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
    return { taskId: null as null, link: (await ctx.db.get(linkId))! };
  });

  // Seed an imported issue → task + link row.
  await t.run((ctx) =>
    applyNormalizedEvent(ctx, {
      event: {
        kind: "issue.opened",
        externalIssueId: "I_kwDOABC123",
        issueNumber: 42,
        externalUpdatedAt: 1_700_000_000_000,
        title: "Seeded issue",
        body: "",
        url: "https://github.com/acme/web/issues/42",
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
      },
      link,
    }),
  );

  const createdTaskId = await t.run(async (ctx) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
    return task!._id;
  });

  return { asUser, link, taskId: createdTaskId };
}

describe("taskComments.list with external author", () => {
  // Inbound comments schedule a `seedCommentBody` Node action and Ripple-native
  // comments on a linked task schedule the outbound push; both must be drained.
  // GitHub creds are unset so the outbound push takes the inert missing-creds
  // branch rather than attempting a real HTTP call.
  let savedAppId: string | undefined;
  let savedKey: string | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (savedAppId !== undefined) process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  it("surfaces externalAuthor on comments inserted by inbound sync", async () => {
    const t = createTestContext();
    const { asUser, link, taskId } = await setupTaskWithLink(t);

    const externalAuthor = {
      login: "external-contributor",
      avatarUrl: "https://github.com/external-contributor.png",
      url: "https://github.com/external-contributor",
    };

    const event: NormalizedCommentCreatedEvent = {
      kind: "comment.created",
      externalCommentId: "IC_kwDOABC123_1",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: 1_700_000_010_000,
      body: "From GitHub",
      externalAuthor,
    };
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const comments = await asUser.query(api.taskComments.list, { taskId });
    expect(comments).toHaveLength(1);
    // Body is re-rendered to BlockNote JSON; the markdown text survives inside it.
    expect(comments[0]?.body).toContain("From GitHub");
    expect(() => JSON.parse(comments[0]!.body)).not.toThrow();
    expect(comments[0]?.externalAuthor).toEqual(externalAuthor);
  });

  it("returns undefined externalAuthor for a native Ripple comment", async () => {
    const t = createTestContext();
    const { asUser, taskId } = await setupTaskWithLink(t);

    await asUser.mutation(api.taskComments.create, {
      taskId,
      body: "From Ripple",
      bodyMarkdown: "From Ripple",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const comments = await asUser.query(api.taskComments.list, { taskId });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.externalAuthor).toBeUndefined();
  });
});
