import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeReconciliationEvents } from "../convex/integrations/core/forceResync";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import { api, internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import { withTriggers } from "../convex/dbTriggers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";

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

/** The operator surface `backgroundJobFailures` is read through. */
async function makePlatformAdmin(t: ReturnType<typeof createTestContext>) {
  const { userId, asUser } = await setupAuthenticatedUser(t, {
    name: "Platform Admin",
    email: "ops-resync@test.com",
  });
  await t.run((ctx) => ctx.db.patch(userId, { isPlatformAdmin: true }));
  return asUser;
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

  /**
   * Every synthesized event lands, not just the first. The inbound ordering
   * guard drops an event whose `externalUpdatedAt` is not strictly newer than
   * the link mirror's — and each applied event advances that mirror. So a
   * synthesis that stamps all of its events with one identical `now` converges
   * only its first facet and silently abandons the rest: an issue that drifted
   * on state AND assignees would reopen but never get its assignee back.
   */
  it("end-to-end: an issue drifted on both state and assignees converges on both", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const { triageStatusId, taskId, link, memberId } = await t.run(
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
        // The GitHub assignee, resolvable as a workspace member by login.
        const memberId = await ctx.db.insert("users", {
          name: "Carol",
          githubLogin: "carol",
        });
        await ctx.db.insert("workspaceMembers", {
          userId: memberId,
          workspaceId,
          role: WorkspaceRole.MEMBER,
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
          externalAuthor,
        });
        return {
          triageStatusId,
          taskId,
          memberId,
          link: (await ctx.db.get(linkId)) as Doc<"projectIntegrationLinks">,
        };
      },
    );

    const carol = {
      login: "carol",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      url: "https://github.com/carol",
    };
    const events = synthesizeReconciliationEvents({
      now: 2_000_000_000_000,
      ripple: { completed: true },
      github: {
        ...baseIssue,
        externalIssueId: "I_drifted",
        state: "open",
        assignees: [carol],
      },
    });

    await t.run(async (ctx) => {
      for (const event of events) {
        await applyNormalizedEvent(ctx, { event, link });
      }
    });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.statusId).toBe(triageStatusId);
    expect(task?.assigneeId).toBe(memberId);
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
    const assignees = events.find((e) => e.kind === "issue.assignees_changed");
    expect(assignees).toMatchObject({
      externalIssueId: "I_kw1",
      issueNumber: 42,
      assignees: [carol],
    });
    // Not `now` itself: stamps are strictly increasing in emission order so
    // every facet clears the inbound ordering guard (see the both-drift test).
    expect(assignees!.externalUpdatedAt).toBeGreaterThan(now);
  });

  it("stamps every emitted event with a strictly increasing externalUpdatedAt", () => {
    const now = 1_700_000_000_000;
    const events = synthesizeReconciliationEvents({
      now,
      // Drift on state as well, so all three event kinds are emitted.
      ripple: { completed: true },
      github: { ...baseIssue, state: "open", labels: ["bug"] },
    });
    const stamps = events.map((e) => e.externalUpdatedAt);
    expect(stamps).toHaveLength(3);
    expect(stamps[0]).toBe(now);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
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

  /**
   * The worst of the two throw paths, because the user is actively told it
   * worked. `forceResync` writes the `integration.force_resync` audit entry and
   * returns success the moment the action is scheduled; the installation token
   * is then minted lazily on the first request, and `mintInstallationToken`
   * throws on any non-2xx. A revoked or suspended installation therefore makes
   * the whole resync die at offset 0 — nothing converged, nothing rescheduled,
   * and (until this) nothing recorded anywhere an operator looks.
   */
  it("records the give-up when the installation token cannot be minted", async () => {
    const t = createTestContext();
    const { linkId } = await setupLinkedIssues(t, 3);
    const asAdmin = await makePlatformAdmin(t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).includes("/access_tokens")
          ? new Response("installation suspended", { status: 403 })
          : new Response("nope", { status: 404 }),
      ),
    );

    await expect(
      t.action(internal.integrations.github.forceResyncAction.runForceResync, {
        projectIntegrationLinkId: linkId,
      }),
    ).rejects.toThrow();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: "integrations.forceResync",
      key: linkId,
    });
  });

  /**
   * The deployment-level version of the same silence: with no App credentials
   * configured the drain returned `null` on its first line, having already let
   * the mutation write an audit entry claiming the resync happened.
   */
  it("records the give-up when the deployment has no GitHub App credentials", async () => {
    const t = createTestContext();
    const { linkId } = await setupLinkedIssues(t, 1);
    const asAdmin = await makePlatformAdmin(t);
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;

    await t.action(
      internal.integrations.github.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: linkId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const { failures } = await asAdmin.query(api.admin.jobs.list, {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: "integrations.forceResync",
      key: linkId,
    });
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
