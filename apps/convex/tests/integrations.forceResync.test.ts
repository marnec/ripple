import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeReconciliationEvents } from "../convex/integrations/core/forceResync";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Generate a throwaway RSA PEM so the action's JWT signing succeeds. */
async function generateTestKeyPem(): Promise<string> {
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
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

const externalAuthor = {
  login: "octocat",
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  url: "https://github.com/octocat",
};

const baseIssue = {
  externalIssueId: "I_kw1",
  issueNumber: 42,
  title: "Issue title",
  body: "issue body",
  url: "https://github.com/acme/web/issues/42",
  externalAuthor,
  labels: [] as string[],
  assignees: [] as { login: string; avatarUrl: string; url: string }[],
};

describe("integrations/core/forceResync.synthesizeReconciliationEvents", () => {
  it("emits issue.reopened when GitHub is open but Ripple is completed", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: true },
      github: { ...baseIssue, state: "open" },
    });
    expect(events).toContainEqual({
      kind: "issue.reopened",
      externalIssueId: "I_kw1",
      issueNumber: 42,
      externalUpdatedAt: now,
      title: "Issue title",
      body: "issue body",
      url: "https://github.com/acme/web/issues/42",
      externalAuthor,
    });
  });

  it("emits issue.closed when GitHub is closed but Ripple is open", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: false },
      github: {
        ...baseIssue,
        state: "closed",
        stateReason: "completed",
      },
    });
    expect(events).toContainEqual({
      kind: "issue.closed",
      externalIssueId: "I_kw1",
      issueNumber: 42,
      externalUpdatedAt: now,
      title: "Issue title",
      body: "issue body",
      url: "https://github.com/acme/web/issues/42",
      externalAuthor,
      stateReason: "completed",
    });
  });

  it("forwards stateReason='not_planned' when GitHub closed it as not planned", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: false },
      github: {
        ...baseIssue,
        state: "closed",
        stateReason: "not_planned",
      },
    });
    const closed = events.find((e) => e.kind === "issue.closed");
    expect(closed?.kind === "issue.closed" && closed.stateReason).toBe(
      "not_planned",
    );
  });

  it("does not emit open/close events when there is no state drift", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: true },
      github: { ...baseIssue, state: "closed", stateReason: "completed" },
    });
    expect(events.find((e) => e.kind === "issue.reopened")).toBeUndefined();
    expect(events.find((e) => e.kind === "issue.closed")).toBeUndefined();
  });

  it("always emits issue.labels_changed carrying the current GitHub label set", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: false },
      github: { ...baseIssue, state: "open", labels: ["bug", "frontend"] },
    });
    expect(events).toContainEqual({
      kind: "issue.labels_changed",
      externalIssueId: "I_kw1",
      issueNumber: 42,
      externalUpdatedAt: now,
      labels: ["bug", "frontend"],
    });
  });

  it("end-to-end: drifted closed-in-Ripple task is reopened to triage when GitHub says open", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    // Project needs triage + a completed status. The task starts in the
    // completed one; after resync it must end up in triage.
    const { triageStatusId, doneStatusId, taskId, link } = await t.run(
      async (ctx) => {
        const triageStatusId = await ctx.db.insert("taskStatuses", {
          projectId,
          name: "Triage",
          color: "bg-amber-500",
          order: 0,
          isDefault: false,
          isCompleted: false,
          isTriage: true,
        });
        const doneStatusId = await ctx.db.insert("taskStatuses", {
          projectId,
          name: "Done",
          color: "bg-green-500",
          order: 1,
          isDefault: false,
          isCompleted: true,
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
        const taskId = await withTriggers(ctx).db.insert("tasks", {
          projectId,
          workspaceId,
          title: "Drifted task",
          statusId: doneStatusId,
          priority: "medium",
          completed: true,
          creatorId: botUserId,
        });
        await ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: linkId,
          externalIssueId: "I_drifted",
          externalState: "closed",
          externalUpdatedAt: 1_000,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://github.com/octocat.png",
            url: "https://github.com/octocat",
          },
        });
        return {
          triageStatusId,
          doneStatusId,
          taskId,
          link: (await ctx.db.get(linkId)) as Doc<"projectIntegrationLinks">,
        };
      },
    );

    // Synthesize against current GitHub truth (open) + Ripple state (completed).
    const events = synthesizeReconciliationEvents({
      now: 2_000_000_000_000,
      ripple: { completed: true },
      github: {
        externalIssueId: "I_drifted",
        issueNumber: 7,
        state: "open",
        title: "Drifted task",
        body: "",
        url: "https://github.com/acme/web/issues/7",
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png",
          url: "https://github.com/octocat",
        },
        labels: [],
        assignees: [],
      },
    });

    await t.run(async (ctx) => {
      for (const event of events) {
        await applyNormalizedEvent(ctx, { event, link });
      }
    });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.statusId).toBe(triageStatusId);
    expect(task?.completed).toBe(false);
    // Ensure we don't accidentally assert against the source status.
    expect(task?.statusId).not.toBe(doneStatusId);
  });

  it("always emits issue.assignees_changed carrying the current GitHub assignee set", () => {
    const now = 1_700_000_000_000;
    const carol = {
      login: "carol",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      url: "https://github.com/carol",
    };
    const events = synthesizeReconciliationEvents({
      now,
      ripple: { completed: false },
      github: { ...baseIssue, state: "open", assignees: [carol] },
    });
    expect(events).toContainEqual({
      kind: "issue.assignees_changed",
      externalIssueId: "I_kw1",
      issueNumber: 42,
      externalUpdatedAt: now,
      assignees: [carol],
    });
  });
});

describe("integrations/github/forceResyncAction.runForceResync (batching + rate limits)", () => {
  let savedAppId: string | undefined;
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedAppId = process.env.GITHUB_APP_ID;
    savedKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = await generateTestKeyPem();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = savedAppId;
    if (savedKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = savedKey;
  });

  /** Seed `count` linked, open, non-drifting tasks under one active link. */
  async function setupLinkedIssues(
    t: ReturnType<typeof createTestContext>,
    count: number,
  ) {
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const linkId = await t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", {
        name: "GitHub",
        isBot: true,
      });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      });
      const linkId = await ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/web",
        externalRepoId: "R_kgDOACME",
      });
      for (let n = 1; n <= count; n++) {
        const taskId = await withTriggers(ctx).db.insert("tasks", {
          projectId,
          workspaceId,
          title: `Issue ${n}`,
          statusId,
          priority: "medium",
          completed: false,
          creatorId: botUserId,
          externalRefs: [
            {
              provider: "github",
              repoFullName: "acme/web",
              issueNumber: n,
              url: `https://github.com/acme/web/issues/${n}`,
            },
          ],
        });
        await ctx.db.insert("taskIntegrationLinks", {
          taskId,
          projectIntegrationLinkId: linkId,
          externalIssueId: `I_${n}`,
          externalState: "open",
          externalUpdatedAt: 1_000,
          externalAuthor: {
            login: "octocat",
            avatarUrl: "https://github.com/octocat.png",
            url: "https://github.com/octocat",
          },
        });
      }
      return linkId;
    });
    return { linkId };
  }

  function issueBody(n: number) {
    return JSON.stringify({
      node_id: `I_${n}`,
      number: n,
      state: "open",
      title: `Issue ${n}`,
      body: "",
      html_url: `https://github.com/acme/web/issues/${n}`,
      user: {
        login: "octocat",
        avatar_url: "https://github.com/octocat.png",
        html_url: "https://github.com/octocat",
      },
      labels: [],
      assignees: [],
    });
  }

  it("drains more than one batch by self-rescheduling (every linked issue is fetched)", async () => {
    const t = createTestContext();
    const { linkId } = await setupLinkedIssues(t, 30); // > RESYNC_BATCH_SIZE (25)

    const fetched: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/access_tokens")) {
          return new Response(JSON.stringify({ token: "ghs_test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const m = u.match(/\/issues\/(\d+)$/);
        if (m) {
          const n = Number(m[1]);
          fetched.push(n);
          return new Response(issueBody(n), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("nope", { status: 404 });
      }),
    );

    await t.action(
      internal.integrations.github.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // All 30 issues fetched exactly once → the second batch ran (a single
    // unbatched action would also fetch 30, but the schedule-drained run
    // proves the offset hand-off works without dropping or double-fetching).
    expect(fetched.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it("a 429 stops the batch and resumes from the rate-limited issue (no skips, no full restart)", async () => {
    const t = createTestContext();
    const { linkId } = await setupLinkedIssues(t, 5);

    const fetched: number[] = [];
    let issue3Calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/access_tokens")) {
          return new Response(JSON.stringify({ token: "ghs_test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        const m = u.match(/\/issues\/(\d+)$/);
        if (m) {
          const n = Number(m[1]);
          // Rate-limit issue #3 on its first fetch only.
          if (n === 3 && issue3Calls === 0) {
            issue3Calls++;
            return new Response("rate limited", {
              status: 429,
              headers: { "Retry-After": "1" },
            });
          }
          fetched.push(n);
          return new Response(issueBody(n), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("nope", { status: 404 });
      }),
    );

    await t.action(
      internal.integrations.github.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // #1 and #2 fetched once (before the 429), then the run resumed at #3 and
    // completed through #5. Every issue ends up successfully fetched exactly
    // once; the 429 caused a pause-and-resume, not a skip or a restart.
    expect(fetched.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
