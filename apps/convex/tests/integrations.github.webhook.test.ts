import { describe, expect, it } from "vitest";
import {
  handleGithubWebhook,
  normalize,
} from "../convex/integrations/github/webhook";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Minimal GitHub `issues.opened` payload — only the fields `normalize`
 * actually reads. Real GitHub payloads are ~300 lines; the test stays
 * legible by inlining the smallest shape that exercises field mapping.
 */
function openedPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    issue: {
      id: 12345, // numeric id; node_id is the stable one (see below)
      node_id: "I_kwDOABC123",
      number: 42,
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      state: "open",
      html_url: "https://github.com/acme/web/issues/42",
      updated_at: "2026-05-15T10:00:00Z",
      user: {
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        html_url: "https://github.com/octocat",
      },
    },
    installation: { id: 999_111 },
    repository: { node_id: "R_kgDOACME", full_name: "acme/web" },
    ...overrides,
  };
}

function closedPayload(
  stateReason: "completed" | "not_planned",
  overrides: Record<string, unknown> = {},
) {
  return {
    action: "closed",
    issue: {
      id: 12345,
      node_id: "I_kwDOABC123",
      number: 42,
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      state: "closed",
      state_reason: stateReason,
      html_url: "https://github.com/acme/web/issues/42",
      updated_at: "2026-05-15T11:00:00Z",
      user: {
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        html_url: "https://github.com/octocat",
      },
    },
    ...overrides,
  };
}

function closedPayloadWithRouting(
  stateReason: "completed" | "not_planned" = "completed",
) {
  return {
    ...closedPayload(stateReason),
    installation: { id: 999_111 },
    repository: { node_id: "R_kgDOACME", full_name: "acme/web" },
  };
}

/**
 * Set up the minimum DB state for routing tests: workspace + admin + project
 * + triage status + bot user + workspaceIntegration (with externalAccountId
 * matching our payload installation id) + projectIntegrationLink (with
 * externalRepoId matching the payload's repository node id).
 */
async function setupWebhookRouting(
  t: ReturnType<typeof createTestContext>,
  opts: {
    externalAccountId?: string;
    externalRepoId?: string;
    externalRepoFullName?: string;
    linkStatus?: "configuring" | "active" | "paused" | "disconnected";
    pausedByBilling?: boolean;
  } = {},
) {
  const {
    externalAccountId = "999111",
    externalRepoId = "R_kgDOACME",
    externalRepoFullName = "acme/web",
    linkStatus = "active",
    pausedByBilling = false,
  } = opts;

  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { triageStatusId, linkId } = await t.run(async (ctx) => {
    const triageStatusId = await ctx.db.insert("taskStatuses", {
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
      externalAccountId,
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: linkStatus,
      pausedByBilling,
      externalRepoFullName,
      externalRepoId,
    });
    return { triageStatusId, linkId };
  });

  return {
    workspaceId,
    projectId,
    triageStatusId,
    linkId,
  };
}

function installationDeletedPayload(installationId = 999_111) {
  return {
    action: "deleted",
    installation: { id: installationId },
  };
}

function installationRepositoriesRemovedPayload(opts: {
  installationId?: number;
  repos: { node_id: string; full_name: string }[];
}) {
  return {
    action: "removed",
    installation: { id: opts.installationId ?? 999_111 },
    repositories_removed: opts.repos,
  };
}

function reopenedPayload() {
  return {
    action: "reopened",
    issue: {
      id: 12345,
      node_id: "I_kwDOABC123",
      number: 42,
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      state: "open",
      state_reason: null,
      html_url: "https://github.com/acme/web/issues/42",
      updated_at: "2026-05-15T12:00:00Z",
      user: {
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
        html_url: "https://github.com/octocat",
      },
    },
  };
}

describe("integrations/github/webhook.normalize", () => {
  it("maps an issues.opened payload to a NormalizedIssueOpenedEvent", () => {
    const event = normalize("issues", openedPayload());

    expect(event).toEqual({
      kind: "issue.opened",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T10:00:00Z"),
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      url: "https://github.com/acme/web/issues/42",
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        url: "https://github.com/octocat",
      },
    });
  });

  it("maps an issues.assigned payload to a NormalizedIssueAssigneesChangedEvent carrying the full assignee set", () => {
    // GitHub's `issues.assigned` event ships the single `assignee` that was
    // just added AND the full current `issue.assignees` array. We normalize
    // against the full set so reconciliation is delta-insensitive.
    const payload = {
      action: "assigned",
      issue: {
        id: 12345,
        node_id: "I_kwDOABC123",
        number: 42,
        title: "Issue with assignees",
        body: "body",
        state: "open",
        html_url: "https://github.com/acme/web/issues/42",
        updated_at: "2026-05-15T15:00:00Z",
        user: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/octocat",
        },
        assignees: [
          {
            login: "alice",
            avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
            html_url: "https://github.com/alice",
          },
          {
            login: "bob",
            avatar_url: "https://avatars.githubusercontent.com/u/3?v=4",
            html_url: "https://github.com/bob",
          },
        ],
      },
      assignee: {
        login: "bob",
        avatar_url: "https://avatars.githubusercontent.com/u/3?v=4",
        html_url: "https://github.com/bob",
      },
    };
    const event = normalize("issues", payload);
    expect(event).toEqual({
      kind: "issue.assignees_changed",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T15:00:00Z"),
      assignees: [
        {
          login: "alice",
          avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
          url: "https://github.com/alice",
        },
        {
          login: "bob",
          avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4",
          url: "https://github.com/bob",
        },
      ],
    });
  });

  it("maps an issues.unassigned payload to a NormalizedIssueAssigneesChangedEvent carrying the surviving assignees", () => {
    const payload = {
      action: "unassigned",
      issue: {
        id: 12345,
        node_id: "I_kwDOABC123",
        number: 42,
        title: "Issue with assignees",
        body: "body",
        state: "open",
        html_url: "https://github.com/acme/web/issues/42",
        updated_at: "2026-05-15T15:30:00Z",
        user: {
          login: "octocat",
          avatar_url: "u",
          html_url: "https://github.com/octocat",
        },
        assignees: [], // both removed
      },
      assignee: { login: "bob", avatar_url: "u", html_url: "https://github.com/bob" },
    };
    const event = normalize("issues", payload);
    expect(event).toEqual({
      kind: "issue.assignees_changed",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T15:30:00Z"),
      assignees: [],
    });
  });

  it("maps an issues.labeled payload to a NormalizedIssueLabelsChangedEvent carrying the full label set", () => {
    // GitHub's `issues.labeled` event ships the `label` that was just added
    // AND the full current `issue.labels` array. We normalize against the
    // full set so reconciliation is delta-insensitive (resilient to dropped
    // or out-of-order deliveries).
    const payload = {
      action: "labeled",
      issue: {
        id: 12345,
        node_id: "I_kwDOABC123",
        number: 42,
        title: "Issue with labels",
        body: "body",
        state: "open",
        html_url: "https://github.com/acme/web/issues/42",
        updated_at: "2026-05-15T13:00:00Z",
        user: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/octocat",
        },
        labels: [
          { name: "Bug" },
          { name: "good first issue" },
        ],
      },
      label: { name: "good first issue" },
    };
    const event = normalize("issues", payload);
    expect(event).toEqual({
      kind: "issue.labels_changed",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T13:00:00Z"),
      labels: ["Bug", "good first issue"],
    });
  });

  it("maps an issues.unlabeled payload to a NormalizedIssueLabelsChangedEvent carrying the surviving label set", () => {
    const payload = {
      action: "unlabeled",
      issue: {
        id: 12345,
        node_id: "I_kwDOABC123",
        number: 42,
        title: "Issue with labels",
        body: "body",
        state: "open",
        html_url: "https://github.com/acme/web/issues/42",
        updated_at: "2026-05-15T14:00:00Z",
        user: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/octocat",
        },
        labels: [{ name: "Bug" }], // "good first issue" was removed
      },
      label: { name: "good first issue" },
    };
    const event = normalize("issues", payload);
    expect(event).toEqual({
      kind: "issue.labels_changed",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T14:00:00Z"),
      labels: ["Bug"],
    });
  });

  it("normalizes an unlabeled-everything payload to an empty label set", () => {
    const payload = {
      action: "unlabeled",
      issue: {
        id: 12345,
        node_id: "I_kwDOABC123",
        number: 42,
        title: "Issue with labels",
        body: "body",
        state: "open",
        html_url: "https://github.com/acme/web/issues/42",
        updated_at: "2026-05-15T14:30:00Z",
        user: {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/octocat",
        },
        labels: [],
      },
      label: { name: "Bug" },
    };
    const event = normalize("issues", payload);
    expect(event).toMatchObject({
      kind: "issue.labels_changed",
      labels: [],
    });
  });

  it("returns null for non-issues / non-installation / non-issue_comment event names", () => {
    expect(normalize("pull_request", openedPayload())).toBeNull();
  });

  it("maps an issue_comment.created payload to a NormalizedCommentCreatedEvent", () => {
    const payload = {
      action: "created",
      issue: { node_id: "I_kwDOABC123", number: 42 },
      comment: {
        node_id: "IC_kwDOABC123_1",
        body: "Thanks for the report!",
        updated_at: "2026-05-15T16:00:00Z",
        user: {
          login: "external-user",
          avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
          html_url: "https://github.com/external-user",
        },
      },
      installation: { id: 999_111 },
      repository: { node_id: "R_kgDOACME", full_name: "acme/web" },
    };
    const event = normalize("issue_comment", payload);
    expect(event).toEqual({
      kind: "comment.created",
      externalCommentId: "IC_kwDOABC123_1",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: Date.parse("2026-05-15T16:00:00Z"),
      body: "Thanks for the report!",
      externalAuthor: {
        login: "external-user",
        avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
        url: "https://github.com/external-user",
      },
    });
  });

  it("maps an issue_comment.edited payload to a NormalizedCommentEditedEvent (no author)", () => {
    const payload = {
      action: "edited",
      issue: { node_id: "I_kwDOABC123", number: 42 },
      comment: {
        node_id: "IC_kwDOABC123_1",
        body: "Edited body",
        updated_at: "2026-05-15T17:00:00Z",
        user: {
          login: "external-user",
          avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
          html_url: "https://github.com/external-user",
        },
      },
    };
    const event = normalize("issue_comment", payload);
    expect(event).toEqual({
      kind: "comment.edited",
      externalCommentId: "IC_kwDOABC123_1",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: Date.parse("2026-05-15T17:00:00Z"),
      body: "Edited body",
    });
  });

  it("maps an issue_comment.deleted payload to a NormalizedCommentDeletedEvent", () => {
    const payload = {
      action: "deleted",
      issue: { node_id: "I_kwDOABC123", number: 42 },
      comment: {
        node_id: "IC_kwDOABC123_1",
        body: "Will be gone",
        updated_at: "2026-05-15T18:00:00Z",
        user: {
          login: "external-user",
          avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
          html_url: "https://github.com/external-user",
        },
      },
    };
    const event = normalize("issue_comment", payload);
    expect(event).toEqual({
      kind: "comment.deleted",
      externalCommentId: "IC_kwDOABC123_1",
      externalIssueId: "I_kwDOABC123",
      externalUpdatedAt: Date.parse("2026-05-15T18:00:00Z"),
    });
  });

  it("returns null for issue_comment actions we don't act on", () => {
    expect(
      normalize("issue_comment", { action: "unknown" }),
    ).toBeNull();
  });

  it("maps an installation.deleted payload to NormalizedInstallationDeletedEvent", () => {
    const event = normalize("installation", installationDeletedPayload(999_111));
    expect(event).toEqual({
      kind: "installation.deleted",
      externalAccountId: "999111",
    });
  });

  it("returns null for installation actions we don't act on (created, suspend, unsuspend, …)", () => {
    expect(
      normalize("installation", { action: "created", installation: { id: 1 } }),
    ).toBeNull();
    expect(
      normalize("installation", { action: "suspend", installation: { id: 1 } }),
    ).toBeNull();
    expect(
      normalize("installation_repositories", {
        action: "added",
        installation: { id: 1 },
        repositories_added: [],
      }),
    ).toBeNull();
  });

  it("maps an installation_repositories.removed payload to NormalizedRepositoriesRemovedEvent", () => {
    const event = normalize(
      "installation_repositories",
      installationRepositoriesRemovedPayload({
        installationId: 999_111,
        repos: [
          { node_id: "R_kgDOREMOVED1", full_name: "acme/a" },
          { node_id: "R_kgDOREMOVED2", full_name: "acme/b" },
        ],
      }),
    );
    expect(event).toEqual({
      kind: "installation_repositories.removed",
      externalAccountId: "999111",
      externalRepoIds: ["R_kgDOREMOVED1", "R_kgDOREMOVED2"],
    });
  });

  it("maps an issues.reopened payload to a NormalizedIssueReopenedEvent", () => {
    const event = normalize("issues", reopenedPayload());
    expect(event).toEqual({
      kind: "issue.reopened",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T12:00:00Z"),
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      url: "https://github.com/acme/web/issues/42",
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        url: "https://github.com/octocat",
      },
    });
  });

  it("propagates state_reason='not_planned' from issues.closed", () => {
    const event = normalize("issues", closedPayload("not_planned"));
    expect(event).toMatchObject({
      kind: "issue.closed",
      stateReason: "not_planned",
    });
  });

  it("defaults stateReason to 'completed' when issues.closed payload omits it", () => {
    const payload = closedPayload("completed");
    // GitHub historically omits state_reason on legacy closes — simulate that.
    (payload.issue as Record<string, unknown>).state_reason = null;
    const event = normalize("issues", payload);
    expect(event).toMatchObject({ stateReason: "completed" });
  });

  it("maps an issues.closed (state_reason='completed') payload to a NormalizedIssueClosedEvent", () => {
    const event = normalize("issues", closedPayload("completed"));

    expect(event).toEqual({
      kind: "issue.closed",
      externalIssueId: "I_kwDOABC123",
      issueNumber: 42,
      externalUpdatedAt: Date.parse("2026-05-15T11:00:00Z"),
      title: "Page crashes when toggling dark mode",
      body: "Steps to reproduce:\n1. Open settings",
      url: "https://github.com/acme/web/issues/42",
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        url: "https://github.com/octocat",
      },
      stateReason: "completed",
    });
  });

  it("propagates closed_by from an issues.closed payload onto closedBy", () => {
    const payload = {
      ...closedPayload("completed"),
      issue: {
        ...closedPayload("completed").issue,
        closed_by: {
          login: "mergebot",
          avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
          html_url: "https://github.com/mergebot",
        },
      },
    };
    const event = normalize("issues", payload);
    expect(event).toMatchObject({
      kind: "issue.closed",
      closedBy: {
        login: "mergebot",
        avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4",
        url: "https://github.com/mergebot",
      },
    });
  });

  it("omits closedBy when the issues.closed payload has no closed_by user", () => {
    const event = normalize("issues", closedPayload("completed"));
    expect(event).toMatchObject({ kind: "issue.closed" });
    expect((event as { closedBy?: unknown }).closedBy).toBeUndefined();
  });
});

describe("integrations/github/webhook.handleGithubWebhook", () => {
  it("happy path: issues.opened with valid installation+repo → task in triage", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId } = await setupWebhookRouting(t);

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: openedPayload(),
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.statusId).toBe(triageStatusId);
  });

  it("routes installation.deleted to applyInstallationEvent — all workspace links disconnect end-to-end", async () => {
    const t = createTestContext();
    const { linkId } = await setupWebhookRouting(t, {
      externalAccountId: "999111",
    });

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "installation",
        payload: installationDeletedPayload(999_111),
      }),
    );

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.status).toBe("disconnected");
  });

  it("recognizes a repo rename: externalRepoId lookup wins and externalRepoFullName is updated silently", async () => {
    const t = createTestContext();
    const { projectId, linkId } = await setupWebhookRouting(t, {
      externalRepoFullName: "acme/old-name",
    });

    // Payload carries the *new* full_name but the same stable node_id.
    const payload = openedPayload();
    (payload.repository as Record<string, unknown>).full_name = "acme/new-name";

    await t.run((ctx) =>
      handleGithubWebhook(ctx, { eventName: "issues", payload }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalRepoFullName).toBe("acme/new-name");
  });

  it("drops the event silently when the installation id is unknown to this workspace", async () => {
    const t = createTestContext();
    const { projectId } = await setupWebhookRouting(t, {
      externalAccountId: "different-install-id",
    });

    await expect(
      t.run((ctx) =>
        handleGithubWebhook(ctx, {
          eventName: "issues",
          payload: openedPayload(),
        }),
      ),
    ).resolves.not.toThrow();

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(0);
  });

  it("drops the event silently when the repo id is unknown under a known installation", async () => {
    const t = createTestContext();
    const { projectId } = await setupWebhookRouting(t, {
      externalRepoId: "R_kgDOOTHER",
    });

    await expect(
      t.run((ctx) =>
        handleGithubWebhook(ctx, {
          eventName: "issues",
          payload: openedPayload(),
        }),
      ),
    ).resolves.not.toThrow();

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(0);
  });

  it("drops the event silently when the link is admin-paused (status='paused')", async () => {
    const t = createTestContext();
    const { projectId } = await setupWebhookRouting(t, { linkStatus: "paused" });

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: openedPayload(),
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(0);
  });

  it("drops the event silently when the link is entitlement-frozen (pausedByBilling=true)", async () => {
    const t = createTestContext();
    const { projectId } = await setupWebhookRouting(t, {
      pausedByBilling: true,
    });

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: openedPayload(),
      }),
    );

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(0);
  });

  it("issue_comment.created routes through syncIn and creates a taskComments row", async () => {
    const t = createTestContext();
    await setupWebhookRouting(t);

    // Seed an imported issue so the comment has a parent task.
    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: openedPayload(),
      }),
    );

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issue_comment",
        payload: {
          action: "created",
          issue: { node_id: "I_kwDOABC123", number: 42 },
          comment: {
            node_id: "IC_kwDOABC123_1",
            body: "External comment body",
            updated_at: "2026-05-15T16:00:00Z",
            user: {
              login: "external-user",
              avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
              html_url: "https://github.com/external-user",
            },
          },
          installation: { id: 999_111 },
          repository: { node_id: "R_kgDOACME", full_name: "acme/web" },
        },
      }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("External comment body");
  });

  it("drops an issue_comment event when the link is entitlement-frozen", async () => {
    const t = createTestContext();
    // Seed the issue before freezing (the open ran while still active).
    await setupWebhookRouting(t);
    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issues",
        payload: openedPayload(),
      }),
    );

    // Freeze the link via entitlement.
    await t.run(async (ctx) => {
      const link = await ctx.db
        .query("projectIntegrationLinks")
        .withIndex("by_externalRepo", (q) =>
          q.eq("externalRepoId", "R_kgDOACME"),
        )
        .unique();
      await ctx.db.patch(link!._id, { pausedByBilling: true });
    });

    await t.run((ctx) =>
      handleGithubWebhook(ctx, {
        eventName: "issue_comment",
        payload: {
          action: "created",
          issue: { node_id: "I_kwDOABC123", number: 42 },
          comment: {
            node_id: "IC_kwDOABC123_FROZEN",
            body: "Should not be inserted",
            updated_at: "2026-05-15T16:00:00Z",
            user: {
              login: "external-user",
              avatar_url: "https://avatars.githubusercontent.com/u/9?v=4",
              html_url: "https://github.com/external-user",
            },
          },
          installation: { id: 999_111 },
          repository: { node_id: "R_kgDOACME", full_name: "acme/web" },
        },
      }),
    );

    const comments = await t.run((ctx) =>
      ctx.db.query("taskComments").collect(),
    );
    expect(comments).toHaveLength(0);
  });
});
