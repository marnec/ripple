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

  it("returns null for issues actions we don't handle yet (e.g. assigned, labeled)", () => {
    const payload = openedPayload({ action: "assigned" });
    expect(normalize("issues", payload)).toBeNull();
  });

  it("returns null for non-issues event names (pull_request, installation, etc.)", () => {
    expect(normalize("pull_request", openedPayload())).toBeNull();
    expect(normalize("installation", openedPayload())).toBeNull();
    expect(normalize("issue_comment", openedPayload())).toBeNull();
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
});
