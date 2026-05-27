import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { api, internal } from "../convex/_generated/api";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import type {
  NormalizedCommentCreatedEvent,
  NormalizedCommentEditedEvent,
} from "../convex/integrations/core/types";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
} from "./helpers";

/**
 * Comment body translation between GitHub markdown and Ripple BlockNote JSON.
 *
 *  - Inbound: a GitHub comment arrives as markdown; we store it raw, then a
 *    `seedCommentBody` Node action re-renders it to BlockNote JSON (the same
 *    headless-editor strategy as the description seed).
 *  - Outbound: a Ripple comment is BlockNote JSON; the client renders it to
 *    markdown and the dispatcher pushes that, not the JSON.
 */
async function setup(t: ReturnType<typeof createTestContext>) {
  const { userId, asUser } = await setupAuthenticatedUser(t);
  const workspaceId = await t.run(async (ctx) => {
    const wsId = await ctx.db.insert("workspaces", { name: "WS", ownerId: userId });
    await ctx.db.insert("workspaceMembers", {
      userId,
      workspaceId: wsId,
      role: WorkspaceRole.ADMIN,
    });
    return wsId;
  });
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { taskId, link } = await t.run(async (ctx) => {
    const statusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-1",
    });
    const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const taskId = await ctx.db.insert("tasks", {
      projectId,
      workspaceId,
      title: "task",
      statusId,
      priority: "medium",
      completed: false,
      creatorId: userId,
      externalRefs: [
        {
          provider: "github",
          repoFullName: "acme/web",
          issueNumber: 42,
          url: "https://github.com/acme/web/issues/42",
        },
      ],
    });
    await ctx.db.insert("taskIntegrationLinks", {
      taskId,
      projectIntegrationLinkId: projectLinkId,
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: 1_700_000_000_000,
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://github.com/octocat.png",
        url: "https://github.com/octocat",
      },
    });
    const link = (await ctx.db.get(projectLinkId))! as Doc<"projectIntegrationLinks">;
    return { taskId, link };
  });

  return { asUser, workspaceId, projectId, taskId, link };
}

function commentCreatedEvent(
  overrides: Partial<NormalizedCommentCreatedEvent> = {},
): NormalizedCommentCreatedEvent {
  return {
    kind: "comment.created",
    externalCommentId: "IC_inbound_1",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_010_000,
    body: "**bold** and a list:\n\n- one\n- two",
    externalAuthor: {
      login: "external-user",
      avatarUrl: "https://github.com/external-user.png",
      url: "https://github.com/external-user",
    },
    ...overrides,
  };
}

async function commentFor(
  t: ReturnType<typeof createTestContext>,
  taskId: Id<"tasks">,
): Promise<Doc<"taskComments">> {
  return t.run(async (ctx) => {
    const c = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .first();
    return c!;
  });
}

describe("inbound comment markdown → BlockNote JSON", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedules a comment seed for a non-empty inbound comment body", async () => {
    const t = createTestContext();
    const { link } = await setup(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreatedEvent(), link }),
    );

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const seeds = scheduled.filter((r) =>
      String(r.name ?? "").includes("seedCommentBody"),
    );
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.args[0]).toMatchObject({ markdown: commentCreatedEvent().body });
  });

  it("does not schedule a seed for an empty inbound comment body", async () => {
    const t = createTestContext();
    const { link } = await setup(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: commentCreatedEvent({ body: "   ", externalCommentId: "IC_empty" }),
        link,
      }),
    );

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.filter((r) => String(r.name ?? "").includes("seedCommentBody")),
    ).toHaveLength(0);
  });

  it("re-renders the stored body to BlockNote JSON once the seed runs", async () => {
    const t = createTestContext();
    const { taskId, link } = await setup(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreatedEvent(), link }),
    );

    // Before the seed runs, the body is the raw markdown.
    const before = await commentFor(t, taskId);
    expect(before.body).toBe(commentCreatedEvent().body);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // After the seed, the body is BlockNote JSON (a parseable block array).
    const after = await commentFor(t, taskId);
    const blocks = JSON.parse(after.body) as unknown[];
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("an inbound edit re-schedules a seed and updates the body", async () => {
    const t = createTestContext();
    const { taskId, link } = await setup(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreatedEvent(), link }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const edited: NormalizedCommentEditedEvent = {
      kind: "comment.edited",
      externalCommentId: "IC_inbound_1",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: 1_700_000_020_000,
      body: "# edited heading",
      externalAuthor: commentCreatedEvent().externalAuthor,
    };
    await t.run((ctx) => applyNormalizedEvent(ctx, { event: edited, link }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await commentFor(t, taskId);
    const blocks = JSON.parse(after.body) as Array<{ type: string }>;
    expect(blocks.some((b) => b.type === "heading")).toBe(true);
  });
});

describe("setBodyFromMarkdown guard", () => {
  it("replaces the body only when it still equals the source markdown", async () => {
    const t = createTestContext();
    const { taskId } = await setup(t);

    const commentId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "x" });
      return ctx.db.insert("taskComments", {
        taskId,
        userId: uid,
        body: "raw markdown",
        deleted: false,
      });
    });

    // Matching source → patched to JSON.
    await t.mutation(internal.taskComments.setBodyFromMarkdown, {
      commentId,
      json: '[{"type":"paragraph"}]',
      sourceMarkdown: "raw markdown",
    });
    let comment = await t.run((ctx) => ctx.db.get(commentId));
    expect(comment?.body).toBe('[{"type":"paragraph"}]');

    // Stale source (body already changed) → no-op.
    await t.mutation(internal.taskComments.setBodyFromMarkdown, {
      commentId,
      json: '[{"type":"heading"}]',
      sourceMarkdown: "raw markdown",
    });
    comment = await t.run((ctx) => ctx.db.get(commentId));
    expect(comment?.body).toBe('[{"type":"paragraph"}]');
  });
});
