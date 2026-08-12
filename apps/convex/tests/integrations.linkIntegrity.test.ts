import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  applyInstallationEvent,
  applyNormalizedEvent,
} from "../convex/integrations/core/syncIn";
import { internal } from "../convex/_generated/api";
import { cascadeDelete } from "../convex/cascadeDelete";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type {
  NormalizedCommentCreatedEvent,
  NormalizedCommentEditedEvent,
  NormalizedIssueOpenedEvent,
} from "../convex/integrations/core/types";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Integrity of the integration link rows — the three tables that carry the
 * task ↔ external issue ↔ external comment correspondence.
 *
 * The defects pinned here all share a shape: a lookup that assumed uniqueness
 * where the data model permits several rows, or a row that outlived the thing
 * it pointed at. They are grouped because the cheapest way to keep them fixed
 * is to see the three cases next to each other.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const HUMAN = {
  login: "dev-human",
  avatarUrl: "https://gitlab.example/dev-human.png",
  url: "https://gitlab.example/dev-human",
};

/**
 * A workspace with one linked repo and one already-imported issue.
 *
 * `oauth: true` seeds `oauthRefreshToken`, which is what makes
 * `syncIn` treat the install as user-impersonating (GitLab): its authorship
 * echo guard is deliberately skipped there, because the "bot" login IS the
 * connected human and suppressing on it would drop every real comment. That
 * skip is the precondition for the create-echo race below.
 */
async function setupLinkedRepo(
  t: ReturnType<typeof createTestContext>,
  opts: { oauth?: boolean; externalRepoId?: string } = {},
) {
  const { oauth = false, externalRepoId = "R_kgDOACME" } = opts;
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { botUserId, link } = await t.run(async (ctx) => {
    await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", { name: "Integration bot" });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: oauth ? "gitlab" : "github",
      externalAccountId: "install-123",
      externalBotLogin: oauth ? HUMAN.login : "ripple-app[bot]",
      ...(oauth ? { oauthRefreshToken: "refresh-token" } : {}),
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId,
    });
    return { botUserId, link: (await ctx.db.get(linkId))! };
  });

  const openedEvent: NormalizedIssueOpenedEvent = {
    kind: "issue.opened",
    externalIssueId: "I_kwDOABC123",
    issueNumber: 42,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Page crashes when toggling dark mode",
    body: "repro steps",
    url: "https://acme.example/web/issues/42",
    externalAuthor: HUMAN,
  };
  await t.run((ctx) => applyNormalizedEvent(ctx, { event: openedEvent, link }));

  const { taskId, taskLinkId } = await t.run(async (ctx) => {
    const taskLink = (
      await ctx.db.query("taskIntegrationLinks").collect()
    )[0]!;
    return { taskId: taskLink.taskId, taskLinkId: taskLink._id };
  });

  return {
    userId,
    workspaceId,
    projectId,
    botUserId,
    link: link as Doc<"projectIntegrationLinks">,
    taskId,
    taskLinkId,
  };
}

function commentCreated(
  overrides: Partial<NormalizedCommentCreatedEvent> = {},
): NormalizedCommentCreatedEvent {
  return {
    kind: "comment.created",
    externalCommentId: "9001",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_005_000,
    body: "ship it",
    externalAuthor: HUMAN,
    ...overrides,
  };
}

function commentEdited(
  overrides: Partial<NormalizedCommentEditedEvent> = {},
): NormalizedCommentEditedEvent {
  return {
    kind: "comment.edited",
    externalCommentId: "9001",
    externalIssueId: "I_kwDOABC123",
    externalUpdatedAt: 1_700_000_010_000,
    body: "ship it (edited)",
    ...overrides,
  };
}

// ── The outbound create echo race ────────────────────────────────────

describe("recordCommentCreateSuccess — outbound comment echo race", () => {
  it("webhook lands first: one comment and one link survive, both Ripple-native", async () => {
    const t = createTestContext();
    const { userId, taskId, taskLinkId, link } = await setupLinkedRepo(t, {
      oauth: true,
    });

    // The comment the user actually wrote in Ripple; its outbound POST has
    // already reached the provider but the recorder has not run yet.
    const rippleCommentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "ship it",
        deleted: false,
      }),
    );

    // The provider's own webhook for that note arrives first.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreated(), link }),
    );

    // ...and only then does the recorder land.
    await t.mutation(
      internal.integrations.core.syncOutMutations.recordCommentCreateSuccess,
      {
        commentId: rippleCommentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "9001",
        externalUpdatedAt: 1_700_000_005_000,
      },
    );

    const { comments, commentLinks } = await t.run(async (ctx) => ({
      comments: await ctx.db.query("taskComments").collect(),
      commentLinks: await ctx.db
        .query("taskCommentIntegrationLinks")
        .collect(),
    }));

    expect(comments).toHaveLength(1);
    expect(comments[0]?._id).toBe(rippleCommentId);
    expect(comments[0]?.userId).toBe(userId);

    expect(commentLinks).toHaveLength(1);
    expect(commentLinks[0]?.taskCommentId).toBe(rippleCommentId);
    // Cleared on the repoint, so `list` renders the human's avatar rather
    // than the provider chip.
    expect(commentLinks[0]?.externalAuthor).toBeUndefined();
  });

  it("a later edit resolves instead of throwing on .unique()", async () => {
    const t = createTestContext();
    const { userId, taskId, taskLinkId, link } = await setupLinkedRepo(t, {
      oauth: true,
    });

    const rippleCommentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "ship it",
        deleted: false,
      }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreated(), link }),
    );
    await t.mutation(
      internal.integrations.core.syncOutMutations.recordCommentCreateSuccess,
      {
        commentId: rippleCommentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "9001",
        externalUpdatedAt: 1_700_000_005_000,
      },
    );

    // This is what used to throw, burn all three receiver attempts, and DLQ.
    await expect(
      t.run((ctx) =>
        applyNormalizedEvent(ctx, { event: commentEdited(), link }),
      ),
    ).resolves.not.toThrow();

    const comment = await t.run((ctx) => ctx.db.get(rippleCommentId));
    expect(comment?.body).toBe("ship it (edited)");
  });

  it("recorder lands first: the webhook's dupe guard still holds", async () => {
    const t = createTestContext();
    const { userId, taskId, taskLinkId, link } = await setupLinkedRepo(t, {
      oauth: true,
    });

    const rippleCommentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "ship it",
        deleted: false,
      }),
    );
    await t.mutation(
      internal.integrations.core.syncOutMutations.recordCommentCreateSuccess,
      {
        commentId: rippleCommentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "9001",
        externalUpdatedAt: 1_700_000_005_000,
      },
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreated(), link }),
    );

    const { comments, commentLinks } = await t.run(async (ctx) => ({
      comments: await ctx.db.query("taskComments").collect(),
      commentLinks: await ctx.db
        .query("taskCommentIntegrationLinks")
        .collect(),
    }));
    expect(comments).toHaveLength(1);
    expect(commentLinks).toHaveLength(1);
  });

  it("is idempotent under a replayed recorder call", async () => {
    const t = createTestContext();
    const { userId, taskId, taskLinkId } = await setupLinkedRepo(t);

    const rippleCommentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "ship it",
        deleted: false,
      }),
    );
    const args = {
      commentId: rippleCommentId,
      taskIntegrationLinkId: taskLinkId,
      externalCommentId: "9001",
      externalUpdatedAt: 1_700_000_005_000,
    };
    await t.mutation(
      internal.integrations.core.syncOutMutations.recordCommentCreateSuccess,
      args,
    );
    await t.mutation(
      internal.integrations.core.syncOutMutations.recordCommentCreateSuccess,
      args,
    );

    const commentLinks = await t.run((ctx) =>
      ctx.db.query("taskCommentIntegrationLinks").collect(),
    );
    expect(commentLinks).toHaveLength(1);
  });
});

// ── Comment ids are only unique within one link ──────────────────────

describe("comment links are resolved per task link, not globally", () => {
  it("two repos sharing a plain-numeric comment id do not collide", async () => {
    const t = createTestContext();
    const a = await setupLinkedRepo(t, { externalRepoId: "R_A" });

    // A second linked repo in the same workspace, with its own imported issue
    // whose comment happens to carry the same plain-numeric id — GitHub's REST
    // comment ids and GitLab note ids live in one string space here.
    const projectB = await setupProject(t, {
      workspaceId: a.workspaceId,
      creatorId: a.userId,
    });
    const { taskLinkB, commentB } = await t.run(async (ctx) => {
      const linkB = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId: a.workspaceId,
        projectId: projectB,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/api",
        externalRepoId: "R_B",
      });
      const statusB = await ctx.db.insert("taskStatuses", {
        projectId: projectB,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      });
      const taskB = await ctx.db.insert("tasks", {
        projectId: projectB,
        workspaceId: a.workspaceId,
        title: "other repo task",
        statusId: statusB,
        priority: "medium",
        completed: false,
        creatorId: a.userId,
      });
      const taskLinkB = await ctx.db.insert("taskIntegrationLinks", {
        taskId: taskB,
        projectIntegrationLinkId: linkB,
        externalIssueId: "I_OTHER",
        externalUpdatedAt: 1_700_000_000_000,
        externalAuthor: HUMAN,
      });
      const commentB = await ctx.db.insert("taskComments", {
        taskId: taskB,
        userId: a.userId,
        body: "untouched",
        deleted: false,
      });
      await ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: commentB,
        taskIntegrationLinkId: taskLinkB,
        externalCommentId: "9001",
        externalUpdatedAt: 1_700_000_000_000,
      });
      return { taskLinkB, commentB };
    });
    expect(taskLinkB).toBeDefined();

    // Repo A receives its own comment 9001, then an edit for it.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreated(), link: a.link }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentEdited(), link: a.link }),
    );

    // B's identically-numbered comment is untouched, and neither lookup threw.
    const bodyB = await t.run(async (ctx) => (await ctx.db.get(commentB))?.body);
    expect(bodyB).toBe("untouched");
  });
});

// ── installation_repositories.removed ────────────────────────────────

describe("installation_repositories.removed", () => {
  it("disconnects every live link for the repo, including a second project's", async () => {
    const t = createTestContext();
    const a = await setupLinkedRepo(t, { externalRepoId: "R_SHARED" });

    // The same repo linked from a second project in the same workspace, plus a
    // historical disconnected row from an earlier link/unlink cycle. Both make
    // the repo id non-unique, which is what `.unique()` used to throw on.
    const projectB = await setupProject(t, {
      workspaceId: a.workspaceId,
      creatorId: a.userId,
    });
    const liveB = await t.run(async (ctx) => {
      await ctx.db.insert("projectIntegrationLinks", {
        workspaceId: a.workspaceId,
        projectId: a.projectId,
        status: "disconnected",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_SHARED",
      });
      return await ctx.db.insert("projectIntegrationLinks", {
        workspaceId: a.workspaceId,
        projectId: projectB,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_SHARED",
      });
    });

    await expect(
      t.run((ctx) =>
        applyInstallationEvent(ctx, {
          event: {
            kind: "installation_repositories.removed",
            externalAccountId: "install-123",
            externalRepoIds: ["R_SHARED"],
          },
        }),
      ),
    ).resolves.not.toThrow();

    const statuses = await t.run(async (ctx) => {
      const rows = await ctx.db.query("projectIntegrationLinks").collect();
      return rows.map((r) => r.status);
    });
    expect(statuses.every((s) => s === "disconnected")).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(liveB))).toMatchObject({
      status: "disconnected",
    });
  });

  it("leaves another workspace's link to the same repo alone", async () => {
    const t = createTestContext();
    const a = await setupLinkedRepo(t, { externalRepoId: "R_SHARED" });

    const { workspaceId: otherWs, userId: otherUser } =
      await setupWorkspaceWithAdmin(t);
    const otherProject = await setupProject(t, {
      workspaceId: otherWs,
      creatorId: otherUser,
    });
    const foreignLink = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId: otherWs,
        projectId: otherProject,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_SHARED",
      }),
    );

    await t.run((ctx) =>
      applyInstallationEvent(ctx, {
        event: {
          kind: "installation_repositories.removed",
          externalAccountId: "install-123",
          externalRepoIds: ["R_SHARED"],
        },
      }),
    );

    expect(await t.run((ctx) => ctx.db.get(a.link._id))).toMatchObject({
      status: "disconnected",
    });
    expect(await t.run((ctx) => ctx.db.get(foreignLink))).toMatchObject({
      status: "active",
    });
  });
});

// ── Task deletion must take its integration rows with it ─────────────

describe("task cascade covers the integration link rows", () => {
  it("deleting a task removes its task link and comment link rows", async () => {
    const t = createTestContext();
    const { userId, taskId, taskLinkId, link } = await setupLinkedRepo(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: commentCreated(), link }),
    );
    const rippleCommentId = await t.run((ctx) =>
      ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "native",
        deleted: false,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("taskCommentIntegrationLinks", {
        taskCommentId: rippleCommentId,
        taskIntegrationLinkId: taskLinkId,
        externalCommentId: "9002",
        externalUpdatedAt: 1_700_000_006_000,
      }),
    );

    await t.run((ctx) =>
      cascadeDelete.deleteWithCascade(
        ctx,
        "tasks",
        taskId as unknown as Id<"tasks">,
      ),
    );

    const remaining = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").collect(),
      taskLinks: await ctx.db.query("taskIntegrationLinks").collect(),
      comments: await ctx.db.query("taskComments").collect(),
      commentLinks: await ctx.db
        .query("taskCommentIntegrationLinks")
        .collect(),
    }));

    expect(remaining.tasks).toHaveLength(0);
    // Without the `taskIntegrationLinks` cascade rule this row survives, and
    // the external issue becomes permanently un-importable: `syncIn` returns
    // early on `issues.opened` because a link already exists.
    expect(remaining.taskLinks).toHaveLength(0);
    expect(remaining.comments).toHaveLength(0);
    expect(remaining.commentLinks).toHaveLength(0);
  });
});
