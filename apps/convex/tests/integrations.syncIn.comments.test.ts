import { describe, expect, it } from "vitest";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import type {
  NormalizedCommentCreatedEvent,
  NormalizedCommentDeletedEvent,
  NormalizedCommentEditedEvent,
  NormalizedIssueOpenedEvent,
} from "../convex/integrations/core/types";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Inbound test fixtures — sets up everything `comment.*` events need:
 * workspace, project, triage status, bot user, active link, and an
 * already-imported task (via an issue.opened event).
 */
async function setupInboundWithIssue(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { botUserId, linkDoc } = await t.run(async (ctx) => {
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
    return { botUserId, linkDoc: (await ctx.db.get(linkId))! };
  });

  // Seed an imported issue so a taskIntegrationLinks row exists.
  const openedEvent: NormalizedIssueOpenedEvent = {
    kind: "issue.opened",
    externalIssueId: "I_kwDOABC123",
    issueNumber: 42,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Page crashes when toggling dark mode",
    body: "repro steps",
    url: "https://github.com/acme/web/issues/42",
    externalAuthor: {
      login: "octocat",
      avatarUrl: "https://github.com/octocat.png",
      url: "https://github.com/octocat",
    },
  };
  await t.run((ctx) =>
    applyNormalizedEvent(ctx, { event: openedEvent, link: linkDoc }),
  );

  return {
    workspaceId,
    projectId,
    botUserId,
    link: linkDoc as Doc<"projectIntegrationLinks">,
    externalIssueId: "I_kwDOABC123",
  };
}

const defaultCommenter = {
  login: "external-user",
  avatarUrl: "https://github.com/external-user.png",
  url: "https://github.com/external-user",
};

function makeCommentCreatedEvent(
  overrides: Partial<NormalizedCommentCreatedEvent> = {},
): NormalizedCommentCreatedEvent {
  return {
    kind: "comment.created",
    externalCommentId: "IC_kwDOABC123_1",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_005_000,
    body: "Thanks for the report — I can reproduce.",
    externalAuthor: defaultCommenter,
    ...overrides,
  };
}

function makeCommentEditedEvent(
  overrides: Partial<NormalizedCommentEditedEvent> = {},
): NormalizedCommentEditedEvent {
  return {
    kind: "comment.edited",
    externalCommentId: "IC_kwDOABC123_1",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_010_000, // newer than created
    body: "Edited body",
    ...overrides,
  };
}

function makeCommentDeletedEvent(
  overrides: Partial<NormalizedCommentDeletedEvent> = {},
): NormalizedCommentDeletedEvent {
  return {
    kind: "comment.deleted",
    externalCommentId: "IC_kwDOABC123_1",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_020_000,
    ...overrides,
  };
}

describe("integrations/core/syncIn comment.created", () => {
  it("creates a taskComments row attributed to the bot user with the event body", async () => {
    const t = createTestContext();
    const { botUserId, link } = await setupInboundWithIssue(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeCommentCreatedEvent(), link }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.userId).toBe(botUserId);
    expect(comments[0]?.body).toBe(
      "Thanks for the report — I can reproduce.",
    );
    expect(comments[0]?.deleted).toBe(false);
  });

  it("is idempotent: same externalCommentId applied twice produces a single comment", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);
    const event = makeCommentCreatedEvent();

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    const links = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(comments).toHaveLength(1);
    expect(links).toHaveLength(1);
  });

  it("creates a taskCommentIntegrationLinks row pointing the externalCommentId at the new comment", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);
    const event = makeCommentCreatedEvent({
      externalCommentId: "IC_kwDOABC123_999",
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event, link }),
    );

    const commentLink = await t.run((ctx) =>
      ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_externalCommentId", (q) =>
          q.eq("externalCommentId", "IC_kwDOABC123_999"),
        )
        .unique(),
    );
    expect(commentLink).not.toBeNull();

    const comment = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(commentLink?.taskCommentId).toBe(comment[0]?._id);
    expect(commentLink?.externalUpdatedAt).toBe(1_700_000_005_000);
    expect(commentLink?.externalAuthor).toEqual(defaultCommenter);
  });
});

describe("integrations/core/syncIn comment.edited", () => {
  it("updates the comment body when externalUpdatedAt is newer", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeCommentCreatedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentEditedEvent({ body: "Reproduced on Safari too." }),
        link,
      }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("Reproduced on Safari too.");

    const commentLink = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(commentLink[0]?.externalUpdatedAt).toBe(1_700_000_010_000);
  });

  it("drops a stale comment.edited event (externalUpdatedAt not newer)", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentCreatedEvent({
          externalUpdatedAt: 1_700_000_005_000,
        }),
        link,
      }),
    );

    // Older edit — should be dropped.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentEditedEvent({
          externalUpdatedAt: 1_700_000_004_000,
          body: "Stale body",
        }),
        link,
      }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments[0]?.body).toBe(
      "Thanks for the report — I can reproduce.",
    );
    const commentLink = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(commentLink[0]?.externalUpdatedAt).toBe(1_700_000_005_000);
  });
});

describe("integrations/core/syncIn comment.deleted", () => {
  it("soft-deletes the comment (sets deleted=true)", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeCommentCreatedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeCommentDeletedEvent(), link }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.deleted).toBe(true);
  });
});

describe("integrations/core/syncIn comment events with no parent issue", () => {
  it("drops a comment.created event whose externalIssueId we never imported", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentCreatedEvent({
          externalIssueId: "I_kwDONEVER999",
        }),
        link,
      }),
    );

    // The seeded issue task has zero comments — no orphan task synthesis.
    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    const links = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(comments).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it("drops a comment.edited / comment.deleted event for an unknown externalCommentId", async () => {
    const t = createTestContext();
    const { link } = await setupInboundWithIssue(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentEditedEvent({
          externalCommentId: "IC_kwDOUNKNOWN",
        }),
        link,
      }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeCommentDeletedEvent({
          externalCommentId: "IC_kwDOUNKNOWN",
        }),
        link,
      }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(0);
  });
});
