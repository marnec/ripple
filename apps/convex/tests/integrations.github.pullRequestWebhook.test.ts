import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handlePullRequestWebhook,
  normalizePullRequestPayload,
  parseBranchIssueNumber,
  parseClosingIssueNumbers,
} from "../convex/integrations/github/pullRequestWebhook";
import { branchNameForIssue } from "../convex/integrations/github/branchesAction";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { GithubClient } from "../convex/integrations/github/client";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

describe("parseClosingIssueNumbers", () => {
  it("matches each closing keyword form, case-insensitively", () => {
    for (const kw of [
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
      "CLOSES",
      "Fixes",
    ]) {
      expect(parseClosingIssueNumbers(`${kw} #27`)).toEqual([27]);
    }
  });

  it("handles the colon form and dedupes across title+body", () => {
    expect(parseClosingIssueNumbers("fixes: #4")).toEqual([4]);
    expect(
      parseClosingIssueNumbers("Closes #2 and resolves #3, also closes #2"),
    ).toEqual([2, 3]);
  });

  it("ignores bare mentions and empty input", () => {
    expect(parseClosingIssueNumbers("see #27 for context")).toEqual([]);
    expect(parseClosingIssueNumbers("closes#27")).toEqual([]); // needs a space
    expect(parseClosingIssueNumbers(null)).toEqual([]);
    expect(parseClosingIssueNumbers(undefined)).toEqual([]);
  });
});

describe("parseBranchIssueNumber", () => {
  it("extracts the leading issue number from the convention", () => {
    expect(parseBranchIssueNumber("27-fix-login")).toBe(27);
    expect(parseBranchIssueNumber("4")).toBe(4);
    expect(parseBranchIssueNumber("marco/12-thing")).toBeNull(); // not leading
    expect(parseBranchIssueNumber("fix-27")).toBeNull();
    expect(parseBranchIssueNumber("release-2024")).toBeNull();
    expect(parseBranchIssueNumber(null)).toBeNull();
  });
});

describe("branchNameForIssue", () => {
  it("builds <number>-<slug>, lowercased and kebabbed", () => {
    expect(branchNameForIssue(27, "Fix login bug")).toBe("27-fix-login-bug");
    expect(branchNameForIssue(3, "  Trailing/Punc!!  ")).toBe("3-trailing-punc");
  });
  it("falls back to the bare number for an empty slug", () => {
    expect(branchNameForIssue(9, "!!!")).toBe("9");
  });
});

describe("normalizePullRequestPayload — branch-name linking", () => {
  it("adds the leading branch issue number to closesIssueNumbers", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload({
        pull_request: {
          node_id: "PR_x",
          number: 8,
          title: "no keyword here",
          body: "",
          html_url: "https://github.com/acme/web/pull/8",
          draft: false,
          updated_at: "2026-05-20T10:00:00Z",
          head: { ref: "42-some-work" },
          base: { ref: "develop" },
          user: { login: "octocat", avatar_url: "", html_url: "" },
        },
      }),
      [],
    );
    expect(event?.closesIssueNumbers).toEqual([42]);
  });

  it("unions branch number with body closing keywords, deduped", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload({
        pull_request: {
          node_id: "PR_y",
          number: 9,
          title: "feat",
          body: "closes #42 and fixes #7",
          html_url: "https://github.com/acme/web/pull/9",
          draft: false,
          updated_at: "2026-05-20T10:00:00Z",
          head: { ref: "42-some-work" },
          base: { ref: "develop" },
          user: { login: "octocat", avatar_url: "", html_url: "" },
        },
      }),
      [],
    );
    expect(new Set(event?.closesIssueNumbers)).toEqual(new Set([42, 7]));
  });
});

function openedPrPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    pull_request: {
      node_id: "PR_kwDO123",
      number: 7,
      title: "feat: fix dark mode crash",
      html_url: "https://github.com/acme/web/pull/7",
      draft: false,
      updated_at: "2026-05-20T10:00:00Z",
      head: { ref: "fix/dark-mode" },
      base: { ref: "main" },
      user: {
        login: "octocat",
        avatar_url: "https://github.com/octocat.png",
        html_url: "https://github.com/octocat",
      },
    },
    installation: { id: 999_111 },
    repository: {
      node_id: "R_kgDOACME",
      full_name: "acme/web",
      owner: { login: "acme" },
      name: "web",
    },
    ...overrides,
  };
}

async function setupRouting(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
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
    const botUserId = await ctx.db.insert("users", { name: "GitHub" });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "999111",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    return { link: (await ctx.db.get(linkId))! };
  });
  return { workspaceId, projectId, link };
}

async function makeClient(fetchImpl: typeof fetch) {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  let bin = "";
  const bytes = new Uint8Array(pkcs8);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return new GithubClient({
    appId: "1",
    privateKeyPem: pem,
    apiBase: "https://test.example",
    fetchImpl,
  });
}

describe("integrations/github/pullRequestWebhook.normalizePullRequestPayload", () => {
  it("maps an opened payload to a normalized event, carrying resolved closing ids", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload(),
      ["I_kwDOABC123"],
    );
    expect(event).toMatchObject({
      kind: "pullRequest.changed",
      externalPrId: "PR_kwDO123",
      number: 7,
      state: "open",
      headRef: "fix/dark-mode",
      baseRef: "main",
      url: "https://github.com/acme/web/pull/7",
      closesExternalIssueIds: ["I_kwDOABC123"],
    });
  });

  it("maps draft:true to state 'draft'", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload({
        pull_request: { ...openedPrPayload().pull_request, draft: true },
      }),
      [],
    );
    expect(event?.state).toBe("draft");
  });

  it("returns null for non-pull_request events", () => {
    expect(normalizePullRequestPayload("issues", openedPrPayload(), [])).toBeNull();
  });

  function actionPayload(
    action: string,
    pr: Record<string, unknown> = {},
  ) {
    const base = openedPrPayload();
    return {
      ...base,
      action,
      pull_request: { ...base.pull_request, ...pr },
    };
  }

  it("maps a merged close to state 'merged' with mergedAt", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      actionPayload("closed", {
        state: "closed",
        merged: true,
        merged_at: "2026-05-21T12:00:00Z",
      }),
      [],
    );
    expect(event?.state).toBe("merged");
    expect(event?.mergedAt).toBe(Date.parse("2026-05-21T12:00:00Z"));
  });

  it("maps a close-without-merge to state 'closed'", () => {
    const event = normalizePullRequestPayload(
      "pull_request",
      actionPayload("closed", { state: "closed", merged: false }),
      [],
    );
    expect(event?.state).toBe("closed");
    expect(event?.mergedAt).toBeUndefined();
  });

  it("maps converted_to_draft to 'draft' and ready_for_review to 'open'", () => {
    expect(
      normalizePullRequestPayload(
        "pull_request",
        actionPayload("converted_to_draft", { draft: true }),
        [],
      )?.state,
    ).toBe("draft");
    expect(
      normalizePullRequestPayload(
        "pull_request",
        actionPayload("ready_for_review", { draft: false }),
        [],
      )?.state,
    ).toBe("open");
  });

  it("maps reopened to 'open' and edited to the current state", () => {
    expect(
      normalizePullRequestPayload("pull_request", actionPayload("reopened"), [])
        ?.state,
    ).toBe("open");
    expect(
      normalizePullRequestPayload("pull_request", actionPayload("edited"), [])
        ?.state,
    ).toBe("open");
  });

  it("ignores synchronize (and other unhandled actions)", () => {
    expect(
      normalizePullRequestPayload("pull_request", actionPayload("synchronize"), []),
    ).toBeNull();
    expect(
      normalizePullRequestPayload("pull_request", actionPayload("labeled"), []),
    ).toBeNull();
  });
});

describe("integrations/github/pullRequestWebhook.handlePullRequestWebhook (wiring)", () => {
  // The webhook flow schedules follow-up work (notification fanout). Fake timers
  // let each test drain it via `finishAllScheduledFunctions` so a scheduled fn
  // can't fire after the test's convex-test context is torn down (which surfaced
  // as a flaky "Patch on non-existent scheduled_functions" uncaught error).
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("end-to-end: GraphQL-resolved closing refs flow through to a PR attached to the imported task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupRouting(t);

    // Import the issue the PR will close.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: {
          kind: "issue.opened",
          externalIssueId: "I_kwDOABC123",
          issueNumber: 42,
          externalUpdatedAt: 1_700_000_000_000,
          title: "Dark mode crash",
          body: "repro",
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

    // Fake GraphQL endpoint returns the closing issue node id.
    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: { nodes: [{ id: "I_kwDOABC123" }] },
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = await makeClient(fakeFetch as unknown as typeof fetch);

    const payload = openedPrPayload();
    const closesIds = await client.fetchClosingIssueNodeIds({
      installationToken: "ghs_x",
      owner: "acme",
      repo: "web",
      prNumber: 7,
    });
    const event = normalizePullRequestPayload("pull_request", payload, closesIds);

    await t.run((ctx) =>
      handlePullRequestWebhook(ctx, {
        event: event!,
        externalAccountId: "999111",
        externalRepoId: "R_kgDOACME",
        repoFullName: "acme/web",
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const prs = await t.run((ctx) => ctx.db.query("pullRequests").collect());
    expect(prs).toHaveLength(1);
    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const joins = await t.run((ctx) =>
      ctx.db
        .query("taskPullRequestLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .collect(),
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]?.pullRequestId).toBe(prs[0]?._id);
  });

  it("records lastWebhookAt on the link (parity with the issue/comment path)", async () => {
    const t = createTestContext();
    const { link } = await setupRouting(t);
    const before = Date.now();

    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload(),
      [],
    )!;
    await t.run((ctx) =>
      handlePullRequestWebhook(ctx, {
        event,
        externalAccountId: "999111",
        externalRepoId: "R_kgDOACME",
        repoFullName: "acme/web",
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const updated = await t.run((ctx) => ctx.db.get(link._id));
    expect(updated?.lastWebhookAt).toBeGreaterThanOrEqual(before);
  });

  it("routes past a disconnected historical link for the same repo id (regression: shared routing no longer assumes uniqueness)", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupRouting(t);

    // A relink leaves the old row behind: a second, disconnected link for the
    // SAME externalRepoId. The PR path used to `.unique()` here and throw,
    // flagging the delivery for retry/DLQ.
    const staleLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "disconnected",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      }),
    );

    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload(),
      [],
    )!;
    await t.run((ctx) =>
      handlePullRequestWebhook(ctx, {
        event,
        externalAccountId: "999111",
        externalRepoId: "R_kgDOACME",
        repoFullName: "acme/web",
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Routed to the live link (not the disconnected sibling), without throwing.
    const live = await t.run((ctx) => ctx.db.get(link._id));
    const stale = await t.run((ctx) => ctx.db.get(staleLinkId));
    expect(live?.lastWebhookAt).toBeDefined();
    expect(stale?.lastWebhookAt).toBeUndefined();
  });

  it("drops the delivery when the installation is unknown (no PR row)", async () => {
    const t = createTestContext();
    const { link } = await setupRouting(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: {
          kind: "issue.opened",
          externalIssueId: "I_kwDOABC123",
          issueNumber: 42,
          externalUpdatedAt: 1_700_000_000_000,
          title: "x",
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
    const event = normalizePullRequestPayload(
      "pull_request",
      openedPrPayload(),
      ["I_kwDOABC123"],
    );

    await t.run((ctx) =>
      handlePullRequestWebhook(ctx, {
        event: event!,
        externalAccountId: "does-not-exist",
        externalRepoId: "R_kgDOACME",
        repoFullName: "acme/web",
      }),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const prs = await t.run((ctx) => ctx.db.query("pullRequests").collect());
    expect(prs).toHaveLength(0);
  });
});
