import { describe, expect, it } from "vitest";
import {
  handleGitlabWebhook,
  normalize,
  normalizeMergeRequest,
  verifyGitlabToken,
} from "../convex/integrations/gitlab/webhook";
import type { Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Minimal GitLab `issue` webhook payload — only the fields normalize reads.
 * GitLab's stable global id is `object_attributes.id`; `iid` is the
 * human-facing number. Timestamps use GitLab's historical
 * "YYYY-MM-DD HH:MM:SS UTC" form to prove the parser handles it.
 */
function issuePayload(
  action: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    object_kind: "issue",
    user: {
      id: 7,
      username: "octocat",
      avatar_url: "https://gitlab.com/octocat.png",
      web_url: "https://gitlab.com/octocat",
    },
    project: { id: 42, web_url: "https://gitlab.com/acme/web" },
    object_attributes: {
      id: 301,
      iid: 23,
      title: "Page crashes on dark mode",
      description: "repro steps",
      state: action === "close" ? "closed" : "opened",
      action,
      url: "https://gitlab.com/acme/web/-/issues/23",
      updated_at: "2026-05-20 10:00:00 UTC",
      ...overrides,
    },
  };
}

/**
 * GitLab verifies a webhook delivery by plaintext equality of the
 * `X-Gitlab-Token` header against the per-hook secret token configured when
 * the hook was created — there is no HMAC signature like GitHub's
 * `X-Hub-Signature-256`. The secret is per-project (hooks aren't centralized).
 */
describe("integrations/gitlab/webhook.verifyGitlabToken", () => {
  it("accepts a header that exactly matches the configured secret", () => {
    expect(verifyGitlabToken("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });

  it("rejects a mismatched header", () => {
    expect(verifyGitlabToken("wrong", "s3cr3t-token")).toBe(false);
  });

  it("rejects a header of a different length", () => {
    expect(verifyGitlabToken("s3cr3t", "s3cr3t-token")).toBe(false);
  });

  it("rejects when the header is missing", () => {
    expect(verifyGitlabToken(null, "s3cr3t-token")).toBe(false);
    expect(verifyGitlabToken(undefined, "s3cr3t-token")).toBe(false);
  });

  it("rejects when no secret is configured (never matches on empty)", () => {
    expect(verifyGitlabToken("anything", "")).toBe(false);
    expect(verifyGitlabToken("", "")).toBe(false);
  });
});

describe("integrations/gitlab/webhook.normalize — issue state", () => {
  it("normalizes an opened issue, using the global id and parsing GitLab time", () => {
    const event = normalize(issuePayload("open"));
    expect(event).toEqual({
      kind: "issue.opened",
      externalIssueId: "301",
      issueNumber: 23,
      externalUpdatedAt: Date.parse("2026-05-20T10:00:00Z"),
      title: "Page crashes on dark mode",
      body: "repro steps",
      url: "https://gitlab.com/acme/web/-/issues/23",
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://gitlab.com/octocat.png",
        url: "https://gitlab.com/octocat",
      },
    });
  });

  it("synthesizes externalAuthor.url when the payload omits user.web_url (Issue/Note hooks don't include it)", () => {
    // GitLab's Issue Hook user object is {id, name, username, avatar_url,
    // email} — no web_url. Producing externalAuthor.url=undefined here would
    // fail the taskIntegrationLinks schema. Falls back to <base>/<username>.
    const payload = issuePayload("open");
    delete (payload.user as { web_url?: string }).web_url;
    const event = normalize(payload);
    expect(event?.externalAuthor).toEqual({
      login: "octocat",
      avatarUrl: "https://gitlab.com/octocat.png",
      url: "https://gitlab.com/octocat",
    });
  });

  it("normalizes a closed issue with a default 'completed' state reason", () => {
    const event = normalize(issuePayload("close"));
    expect(event?.kind).toBe("issue.closed");
    expect(event).toMatchObject({
      externalIssueId: "301",
      issueNumber: 23,
      stateReason: "completed",
    });
  });

  it("normalizes a reopened issue", () => {
    const event = normalize(issuePayload("reopen"));
    expect(event?.kind).toBe("issue.reopened");
    expect(event).toMatchObject({ externalIssueId: "301", issueNumber: 23 });
  });

  it("treats a missing description as an empty body", () => {
    const event = normalize(issuePayload("open", { description: null }));
    expect(event).toMatchObject({ kind: "issue.opened", body: "" });
  });

  it("returns null for an unknown object_kind", () => {
    expect(normalize({ object_kind: "wiki_page" })).toBeNull();
  });
});

describe("integrations/gitlab/webhook.normalize — issue update", () => {
  function updatePayload(extra: Record<string, unknown>) {
    return {
      ...issuePayload("update"),
      ...extra,
    };
  }

  it("maps a label change to issue.labels_changed with the current label set", () => {
    const event = normalize(
      updatePayload({
        changes: { labels: { previous: [], current: [{ title: "bug" }] } },
        labels: [{ title: "bug" }, { title: "p1" }],
      }),
    );
    expect(event).toEqual({
      kind: "issue.labels_changed",
      externalIssueId: "301",
      issueNumber: 23,
      externalUpdatedAt: Date.parse("2026-05-20T10:00:00Z"),
      labels: ["bug", "p1"],
    });
  });

  it("maps an assignee change to issue.assignees_changed with the current assignees", () => {
    const event = normalize(
      updatePayload({
        changes: { assignees: { previous: [], current: [{ id: 9 }] } },
        assignees: [
          {
            id: 9,
            username: "alice",
            avatar_url: "https://gitlab.com/alice.png",
            web_url: "https://gitlab.com/alice",
          },
        ],
      }),
    );
    expect(event).toEqual({
      kind: "issue.assignees_changed",
      externalIssueId: "301",
      issueNumber: 23,
      externalUpdatedAt: Date.parse("2026-05-20T10:00:00Z"),
      assignees: [
        {
          login: "alice",
          avatarUrl: "https://gitlab.com/alice.png",
          url: "https://gitlab.com/alice",
        },
      ],
    });
  });

  it("returns null for a plain title/description edit (no label or assignee change)", () => {
    const event = normalize(
      updatePayload({ changes: { title: { previous: "a", current: "b" } } }),
    );
    expect(event).toBeNull();
  });
});

describe("integrations/gitlab/webhook.normalize — note", () => {
  function notePayload(overrides: { noteableType?: string } = {}) {
    const { noteableType = "Issue" } = overrides;
    return {
      object_kind: "note",
      user: {
        id: 7,
        username: "octocat",
        avatar_url: "https://gitlab.com/octocat.png",
        web_url: "https://gitlab.com/octocat",
      },
      project: { id: 42 },
      object_attributes: {
        id: 1244,
        note: "looks good to me",
        noteable_type: noteableType,
        updated_at: "2026-05-21 09:00:00 UTC",
        url: "https://gitlab.com/acme/web/-/issues/23#note_1244",
      },
      issue: { id: 301, iid: 23 },
    };
  }

  it("normalizes an issue note to comment.created, keying off the issue's global id", () => {
    const event = normalize(notePayload());
    expect(event).toEqual({
      kind: "comment.created",
      externalCommentId: "1244",
      externalIssueId: "301",
      externalUpdatedAt: Date.parse("2026-05-21T09:00:00Z"),
      body: "looks good to me",
      externalAuthor: {
        login: "octocat",
        avatarUrl: "https://gitlab.com/octocat.png",
        url: "https://gitlab.com/octocat",
      },
    });
  });

  it("drops notes on a merge request (PRs are attachments, not comment threads)", () => {
    expect(normalize(notePayload({ noteableType: "MergeRequest" }))).toBeNull();
  });
});

describe("integrations/gitlab/webhook.normalizeMergeRequest", () => {
  function mrPayload(
    attrs: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      object_kind: "merge_request",
      user: {
        id: 7,
        username: "octocat",
        avatar_url: "https://gitlab.com/octocat.png",
        web_url: "https://gitlab.com/octocat",
      },
      project: { id: 42, web_url: "https://gitlab.com/acme/web" },
      object_attributes: {
        id: 99,
        iid: 5,
        title: "Fix the thing",
        description: "",
        state: "opened",
        action: "open",
        source_branch: "feature-x",
        target_branch: "develop",
        url: "https://gitlab.com/acme/web/-/merge_requests/5",
        updated_at: "2026-05-22 12:00:00 UTC",
        ...attrs,
      },
    };
  }

  it("normalizes an opened MR to pullRequest.changed (open), using the global id", () => {
    const event = normalizeMergeRequest(mrPayload());
    expect(event).toMatchObject({
      kind: "pullRequest.changed",
      externalPrId: "99",
      number: 5,
      externalUpdatedAt: Date.parse("2026-05-22T12:00:00Z"),
      title: "Fix the thing",
      url: "https://gitlab.com/acme/web/-/merge_requests/5",
      state: "open",
      headRef: "feature-x",
      baseRef: "develop",
      closesExternalIssueIds: [],
    });
  });

  it("maps a draft (work_in_progress) MR to state 'draft'", () => {
    expect(
      normalizeMergeRequest(mrPayload({ work_in_progress: true }))?.state,
    ).toBe("draft");
    expect(normalizeMergeRequest(mrPayload({ draft: true }))?.state).toBe(
      "draft",
    );
  });

  it("maps merged / closed / locked states", () => {
    expect(
      normalizeMergeRequest(mrPayload({ action: "merge", state: "merged" }))
        ?.state,
    ).toBe("merged");
    expect(
      normalizeMergeRequest(mrPayload({ action: "close", state: "closed" }))
        ?.state,
    ).toBe("closed");
    // A locked MR is still an open MR (discussion locked) — not a terminal state.
    expect(
      normalizeMergeRequest(mrPayload({ action: "update", state: "locked" }))
        ?.state,
    ).toBe("open");
  });

  it("sets mergedAt when merged", () => {
    const event = normalizeMergeRequest(
      mrPayload({ action: "merge", state: "merged" }),
    );
    expect(event?.mergedAt).toBe(Date.parse("2026-05-22T12:00:00Z"));
  });

  it("collects closing references from the branch name and the body (seam 5)", () => {
    const event = normalizeMergeRequest(
      mrPayload({
        source_branch: "42-some-work",
        description: "Closes #7 and fixes #9",
      }),
    );
    expect(new Set(event?.closesIssueNumbers)).toEqual(new Set([42, 7, 9]));
  });

  it("returns null for non-state actions like 'approved'", () => {
    expect(normalizeMergeRequest(mrPayload({ action: "approved" }))).toBeNull();
  });

  it("returns null for a non-merge_request payload", () => {
    expect(normalizeMergeRequest({ object_kind: "issue" })).toBeNull();
  });
});

describe("integrations/gitlab/webhook.handleGitlabWebhook", () => {
  async function setupGitlabInbound(
    t: ReturnType<typeof createTestContext>,
    opts: {
      webhookSecret?: string;
      linkStatus?: "configuring" | "active" | "paused" | "disconnected";
    } = {},
  ) {
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    await t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", {
        name: "GitLab",
        isBot: true,
      });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "gitlab",
        externalAccountId: "gl-acct",
        credentialToken: "glpat-xxx",
      });
      await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 0,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      });
      await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: opts.linkStatus ?? "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "42", // matches issuePayload project.id
        webhookSecret: opts.webhookSecret ?? "s3cr3t",
      });
    });
    return { workspaceId, projectId };
  }

  const countTasks = (
    t: ReturnType<typeof createTestContext>,
    projectId: Id<"projects">,
  ) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("tasks")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .collect()
      ).length,
    );

  it("creates a task from an issue.open delivery when the token matches", async () => {
    const t = createTestContext();
    const { projectId } = await setupGitlabInbound(t);
    await t.run((ctx) =>
      handleGitlabWebhook(ctx, {
        payload: issuePayload("open"),
        token: "s3cr3t",
      }),
    );
    expect(await countTasks(t, projectId)).toBe(1);
  });

  it("drops the delivery when the X-Gitlab-Token does not match the link secret", async () => {
    const t = createTestContext();
    const { projectId } = await setupGitlabInbound(t);
    await t.run((ctx) =>
      handleGitlabWebhook(ctx, {
        payload: issuePayload("open"),
        token: "WRONG",
      }),
    );
    expect(await countTasks(t, projectId)).toBe(0);
  });

  it("drops the delivery for an unknown project id", async () => {
    const t = createTestContext();
    const { projectId } = await setupGitlabInbound(t);
    const payload = issuePayload("open");
    (payload as { project: { id: number } }).project = { id: 999 };
    await t.run((ctx) =>
      handleGitlabWebhook(ctx, { payload, token: "s3cr3t" }),
    );
    expect(await countTasks(t, projectId)).toBe(0);
  });

  it("drops the delivery when the link is paused (freeze gate)", async () => {
    const t = createTestContext();
    const { projectId } = await setupGitlabInbound(t, { linkStatus: "paused" });
    await t.run((ctx) =>
      handleGitlabWebhook(ctx, {
        payload: issuePayload("open"),
        token: "s3cr3t",
      }),
    );
    expect(await countTasks(t, projectId)).toBe(0);
  });
});
