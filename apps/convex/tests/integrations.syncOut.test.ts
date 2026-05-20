import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyResponse,
  deriveDesiredExternalState,
  shouldSkipForEcho,
  shouldSkipForFreeze,
  type OutboundResponse,
} from "../convex/integrations/core/syncOut";
import {
  maybeEnqueueAssigneesPush,
  maybeEnqueueLabelsPush,
  maybeEnqueueOutboundPush,
} from "../convex/integrations/core/outboundDispatch";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { RunId } from "@convex-dev/action-retrier";
import { internal } from "../convex/_generated/api";
import { auditLog } from "../convex/auditLog";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

describe("integrations/core/syncOut.classifyResponse", () => {
  it("returns 'success' for a 2xx response", () => {
    const response: OutboundResponse = { status: 200 };
    expect(classifyResponse(response)).toBe("success");
  });

  it.each([400, 401, 403, 404, 422])(
    "returns 'permanent_fail' for 4xx non-429 (%i)",
    (status) => {
      expect(classifyResponse({ status })).toBe("permanent_fail");
    },
  );

  it("returns 'retry' for 429 (rate-limited)", () => {
    expect(classifyResponse({ status: 429, retryAfterMs: 60_000 })).toBe(
      "retry",
    );
  });

  it.each([500, 502, 503, 504])(
    "returns 'retry' for 5xx (%i) — transient server failure",
    (status) => {
      expect(classifyResponse({ status })).toBe("retry");
    },
  );

  it("returns 'retry' for a network error (status null)", () => {
    expect(
      classifyResponse({ status: null, errorMessage: "ECONNRESET" }),
    ).toBe("retry");
  });
});

describe("integrations/core/syncOut.shouldSkipForEcho", () => {
  it("returns true when the desired state already matches the observed state", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: "closed" })).toBe(
      true,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: "open" })).toBe(true);
  });

  it("returns false when desired and observed differ", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: "open" })).toBe(
      false,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: "closed" })).toBe(
      false,
    );
  });

  it("returns false when observed is undefined (never-synced links must push)", () => {
    expect(shouldSkipForEcho({ desired: "closed", observed: undefined })).toBe(
      false,
    );
    expect(shouldSkipForEcho({ desired: "open", observed: undefined })).toBe(
      false,
    );
  });
});

describe("integrations/core/syncOut.shouldSkipForFreeze", () => {
  // Truth table over (status × pausedByBilling). Mirrors the effective-link
  // matrix from entitlements: skip = (effectiveLinkStatus !== "active").
  const matrix: ReadonlyArray<{
    status: "configuring" | "active" | "paused" | "disconnected";
    pausedByBilling: boolean;
    skip: boolean;
  }> = [
    { status: "configuring",  pausedByBilling: false, skip: true  },
    { status: "configuring",  pausedByBilling: true,  skip: true  },
    { status: "active",       pausedByBilling: false, skip: false },
    { status: "active",       pausedByBilling: true,  skip: true  },
    { status: "paused",       pausedByBilling: false, skip: true  },
    { status: "paused",       pausedByBilling: true,  skip: true  },
    { status: "disconnected", pausedByBilling: false, skip: true  },
    { status: "disconnected", pausedByBilling: true,  skip: true  },
  ];

  it.each(matrix)(
    "($status, pausedByBilling=$pausedByBilling) → skip=$skip",
    ({ status, pausedByBilling, skip }) => {
      expect(shouldSkipForFreeze({ status, pausedByBilling })).toBe(skip);
    },
  );
});

describe("integrations/core/syncOut.deriveDesiredExternalState", () => {
  it("completed task → state='closed' with default stateReason='completed'", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: true },
        status: { externalCloseReason: undefined },
      }),
    ).toEqual({ state: "closed", stateReason: "completed" });
  });

  it("completed task with externalCloseReason='not_planned' propagates it as the GitHub state_reason", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: true },
        status: { externalCloseReason: "not_planned" },
      }),
    ).toEqual({ state: "closed", stateReason: "not_planned" });
  });

  it("non-completed task → state='open' with no stateReason", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: false },
        status: { externalCloseReason: undefined },
      }),
    ).toEqual({ state: "open" });
  });

  it("non-completed task ignores any status.externalCloseReason value (it only affects close)", () => {
    expect(
      deriveDesiredExternalState({
        task: { completed: false },
        status: { externalCloseReason: "not_planned" },
      }),
    ).toEqual({ state: "open" });
  });
});

describe("integrations/core/outboundDispatch.maybeEnqueueOutboundPush", () => {
  // The action this dispatcher schedules runs under Node and reads
  // `process.env.GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`. We deliberately
  // unset them so that *if* the dispatcher schedules the action, the action's
  // missing-creds branch fires and writes `lastSyncError`. That gives us an
  // observable "did the action run?" signal without needing to mock HTTP.
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

  async function setupLinkedTask(
    t: ReturnType<typeof createTestContext>,
    opts: {
      linkStatus?: "configuring" | "active" | "paused" | "disconnected";
      pausedByBilling?: boolean;
      taskCompleted?: boolean;
      externalState?: "open" | "closed";
    } = {},
  ) {
    const {
      linkStatus = "active",
      pausedByBilling = false,
      taskCompleted = true,
      externalState = "open",
    } = opts;
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub", isBot: true }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
      }),
    );
    const projectLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        projectId,
        workspaceId,
        status: linkStatus,
        pausedByBilling,
        externalRepoId: "R_kg1",
        externalRepoFullName: "acme/web",
      }),
    );
    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: taskCompleted ? "Done" : "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: taskCompleted,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "Outbound test task",
        statusId,
        priority: "medium",
        completed: taskCompleted,
        creatorId: botUserId,
        externalRefs: [
          {
            provider: "github",
            repoFullName: "acme/web",
            issueNumber: 42,
            url: "https://github.com/acme/web/issues/42",
          },
        ],
      }),
    );
    const linkId = await t.run((ctx) =>
      ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://avatars/octocat.png",
          url: "https://github.com/octocat",
        },
        externalState,
      }),
    );
    return { workspaceId, projectId, taskId, linkId };
  }

  async function readLastSyncError(
    t: ReturnType<typeof createTestContext>,
    linkId: Id<"taskIntegrationLinks">,
  ) {
    const link = await t.run((ctx) => ctx.db.get(linkId));
    return link?.lastSyncError;
  }

  it("active link with mismatched state: action runs (lastSyncError set to missing-creds)", async () => {
    // Sanity: confirms the test plumbing actually schedules + executes the
    // action. With env vars unset, the action records a permanent failure —
    // visible as `lastSyncError`. This is the positive control for the
    // gate-skips-action tests below.
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "active",
      taskCompleted: true,
      externalState: "open", // desired='closed' ≠ observed='open' → no echo skip
    });

    await t.run((ctx) => maybeEnqueueOutboundPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readLastSyncError(t, linkId);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/credentials not configured/i);
  });

  it("freeze gate: paused link does NOT schedule the action", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "paused",
      taskCompleted: true,
      externalState: "open", // would mismatch if not for the freeze
    });

    await t.run((ctx) => maybeEnqueueOutboundPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("freeze gate: pausedByBilling=true does NOT schedule the action", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "active",
      pausedByBilling: true,
      taskCompleted: true,
      externalState: "open",
    });

    await t.run((ctx) => maybeEnqueueOutboundPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("echo gate: desired state already matches externalState does NOT schedule the action", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "active",
      taskCompleted: true,
      externalState: "closed", // desired='closed' === observed='closed'
    });

    await t.run((ctx) => maybeEnqueueOutboundPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("retry exhaustion records lastSyncError + integration.sync_failed audit log via onComplete", async () => {
    // Set credentials to junk values so signAppJwt throws on every attempt,
    // forcing the retrier to exhaust its budget. The throw chain proves the
    // onComplete callback fires after the retrier gives up — without that
    // callback wired through, retry exhaustion would silently drop the
    // affordance the PRD requires.
    process.env.GITHUB_APP_ID = "test-app-id";
    process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nGARBAGE\n-----END PRIVATE KEY-----\n";

    const t = createTestContext();
    const { workspaceId, taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "active",
      taskCompleted: true,
      externalState: "open",
    });

    await t.run((ctx) => maybeEnqueueOutboundPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readLastSyncError(t, linkId);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/retry.*exhaust|exhausted|failed/i);

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "tasks",
        resourceId: taskId,
      }),
    );
    const failed = logs.find(
      (l: { action: string }) => l.action === "integration.sync_failed",
    );
    expect(failed).toBeDefined();
    expect(failed?.scope).toBe(workspaceId);
  });

  it("concurrent in-flight pushes are tracked independently — a failed run records lastSyncError while another run for the same task stays pending", async () => {
    // Regression: the dispatcher used to stamp a single `outboundRunId` field
    // on the link, so two concurrent pushes for the same task (e.g. a status
    // flip and a description push) clobbered each other — the loser's
    // onComplete found no link and silently dropped its retry-exhaustion
    // failure. The `integrationOutboundRuns` side table tracks each run.
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      externalState: "open",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("integrationOutboundRuns", {
        runId: "run_A",
        taskId,
      });
      await ctx.db.insert("integrationOutboundRuns", {
        runId: "run_B",
        taskId,
      });
    });

    await t.mutation(
      internal.integrations.github.syncOutMutations.onOutboundComplete,
      {
        runId: "run_A" as RunId,
        result: { type: "failed", error: "boom" },
      },
    );

    // run_A's failure surfaced on the link...
    const err = await readLastSyncError(t, linkId);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/exhaust/i);

    // ...and run_B is still tracked (was not clobbered by run_A).
    const remaining = await t.run((ctx) =>
      ctx.db.query("integrationOutboundRuns").collect(),
    );
    expect(remaining.map((r) => r.runId)).toEqual(["run_B"]);
  });

  it("onOutboundComplete success drops the tracking row without writing lastSyncError", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      externalState: "open",
    });
    await t.run((ctx) =>
      ctx.db.insert("integrationOutboundRuns", { runId: "run_ok", taskId }),
    );

    await t.mutation(
      internal.integrations.github.syncOutMutations.onOutboundComplete,
      {
        runId: "run_ok" as RunId,
        result: { type: "success", returnValue: null },
      },
    );

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
    const remaining = await t.run((ctx) =>
      ctx.db.query("integrationOutboundRuns").collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("recordOutboundSuccess records GitHub's updated_at (not wall-clock) so the bounce-back compares equal under isStale", async () => {
    // Regression: success used to stamp `Date.now()`. If the Convex clock ran
    // ahead of GitHub's, a genuine later GitHub edit could carry a timestamp
    // below the stamped value and be wrongly dropped as stale. We now record
    // GitHub's own `issue.updated_at` from the PATCH response.
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      externalState: "open",
    });
    const githubUpdatedAt = 1_700_000_500_000;

    await t.mutation(
      internal.integrations.github.syncOutMutations.recordOutboundSuccess,
      {
        taskId,
        newExternalState: "closed",
        newExternalStateReason: "completed",
        externalUpdatedAt: githubUpdatedAt,
      },
    );

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalUpdatedAt).toBe(githubUpdatedAt);
    expect(link?.externalState).toBe("closed");
  });

  it("recordLabelsSuccess does NOT bump externalUpdatedAt (echo handled by the set guard; avoids clock-skew drops)", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      externalState: "open",
    });
    // setupLinkedTask seeds externalUpdatedAt: 1_000.
    await t.mutation(
      internal.integrations.github.syncOutMutations.recordLabelsSuccess,
      { taskId, nextLabels: ["bug"] },
    );
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalUpdatedAt).toBe(1_000);
    expect(link?.externalLabels).toEqual(["bug"]);
  });

  it("recordAssigneesSuccess does NOT bump externalUpdatedAt", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      externalState: "open",
    });
    await t.mutation(
      internal.integrations.github.syncOutMutations.recordAssigneesSuccess,
      { taskId, nextLogins: ["octocat"] },
    );
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalUpdatedAt).toBe(1_000);
    expect(link?.externalAssigneeLogins).toEqual(["octocat"]);
  });
});

describe("integrations/github/syncOutMutations.recordOutboundFailure", () => {
  // Audit-log component defers aggregate updates; real timers corrupt
  // convex-test state. Same pattern as integrations.links.test.ts.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setupLinkedTask(t: ReturnType<typeof createTestContext>) {
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub", isBot: true }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
      }),
    );
    const projectLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        projectId,
        workspaceId,
        status: "active",
        pausedByBilling: false,
        externalRepoId: "R_kg1",
        externalRepoFullName: "acme/web",
      }),
    );
    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "Outbound test task",
        statusId,
        priority: "medium",
        completed: false,
        creatorId: botUserId,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://avatars/octocat.png",
          url: "https://github.com/octocat",
        },
        externalState: "open",
      }),
    );

    return { workspaceId, projectId, taskId, botUserId };
  }

  it("permanent failure writes an integration.sync_failed audit-log entry scoped to the workspace", async () => {
    const t = createTestContext();
    const { workspaceId, taskId, botUserId } = await setupLinkedTask(t);

    await t.mutation(
      internal.integrations.github.syncOutMutations.recordOutboundFailure,
      {
        taskId,
        message: "Unprocessable Entity",
        httpStatus: 422,
      },
    );

    const logs = await t.run((ctx) =>
      auditLog.queryByResource(ctx, {
        resourceType: "tasks",
        resourceId: taskId,
      }),
    );
    const failed = logs.find(
      (l: { action: string }) => l.action === "integration.sync_failed",
    );
    expect(failed).toBeDefined();
    expect(failed?.scope).toBe(workspaceId);
    expect(failed?.actorId).toBe(botUserId);
    expect(failed?.metadata).toMatchObject({
      message: "Unprocessable Entity",
      httpStatus: 422,
    });
  });
});

describe("integrations/core/outboundDispatch.maybeEnqueueLabelsPush", () => {
  // Same env-vars-unset trick as the status push tests: with GitHub App
  // credentials missing, the scheduled label-push action records a
  // permanent failure as `lastSyncError`. That gives an observable
  // "did the action run?" signal without mocking HTTP.
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

  async function setupLinkedTask(
    t: ReturnType<typeof createTestContext>,
    opts: {
      linkStatus?: "configuring" | "active" | "paused" | "disconnected";
      pausedByBilling?: boolean;
      taskLabels?: string[];
      externalLabels?: string[];
    } = {},
  ) {
    const {
      linkStatus = "active",
      pausedByBilling = false,
      taskLabels = [],
      externalLabels = [],
    } = opts;
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const botUserId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub", isBot: true }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-1",
      }),
    );
    const projectLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        projectId,
        workspaceId,
        status: linkStatus,
        pausedByBilling,
        externalRepoId: "R_kg1",
        externalRepoFullName: "acme/web",
      }),
    );
    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Todo",
        color: "bg-gray-500",
        order: 0,
        isDefault: true,
        isCompleted: false,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "Outbound labels test",
        statusId,
        priority: "medium",
        completed: false,
        creatorId: botUserId,
        labels: taskLabels,
        externalRefs: [
          {
            provider: "github",
            repoFullName: "acme/web",
            issueNumber: 42,
            url: "https://github.com/acme/web/issues/42",
          },
        ],
      }),
    );
    const linkId = await t.run((ctx) =>
      ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://avatars/octocat.png",
          url: "https://github.com/octocat",
        },
        externalState: "open",
        externalLabels,
      }),
    );
    return { workspaceId, projectId, taskId, linkId };
  }

  async function readLastSyncError(
    t: ReturnType<typeof createTestContext>,
    linkId: Id<"taskIntegrationLinks">,
  ) {
    const link = await t.run((ctx) => ctx.db.get(linkId));
    return link?.lastSyncError;
  }

  it("schedules the label push when task.labels has additions over externalLabels", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      taskLabels: ["bug"],
      externalLabels: [],
    });

    await t.run((ctx) => maybeEnqueueLabelsPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readLastSyncError(t, linkId);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/credentials not configured/i);
  });

  it("schedules the label push when task.labels has removals from externalLabels", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      taskLabels: [],
      externalLabels: ["bug"],
    });

    await t.run((ctx) => maybeEnqueueLabelsPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readLastSyncError(t, linkId);
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/credentials not configured/i);
  });

  it("echo skip: next labels equal externalLabels does NOT schedule the action", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      taskLabels: ["bug", "good first issue"],
      externalLabels: ["good first issue", "bug"], // same set, different order
    });

    await t.run((ctx) => maybeEnqueueLabelsPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("freeze gate: paused link does NOT schedule the action", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      linkStatus: "paused",
      taskLabels: ["bug"],
      externalLabels: [],
    });

    await t.run((ctx) => maybeEnqueueLabelsPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("schedules the assignee push when the assignee's mapped GitHub login is not in externalAssigneeLogins", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    // alice is a workspace member with a mapped GitHub identity.
    const aliceUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Alice" });
      await ctx.db.insert("workspaceMembers", {
        userId: uid, workspaceId, role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: uid, provider: "github", externalLogin: "alice",
      });
      return uid;
    });

    const { taskId, linkId } = await t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        projectId, workspaceId,
        status: "active", pausedByBilling: false,
        externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500",
        order: 0, isDefault: true, isCompleted: false,
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId,
        title: "Outbound assignee tracer",
        statusId, priority: "medium", completed: false,
        creatorId: botUserId,
        assigneeId: aliceUserId,
        externalRefs: [{
          provider: "github", repoFullName: "acme/web",
          issueNumber: 42, url: "https://github.com/acme/web/issues/42",
        }],
      });
      const linkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1", externalUpdatedAt: 1_000,
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://github.com/octocat" },
        externalState: "open",
        externalAssigneeLogins: [], // GitHub knows no assignees yet
      });
      return { taskId, linkId };
    });

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const err = await readLastSyncError(t, linkId);
    // Action ran (and failed on missing creds) → confirms it was scheduled.
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/credentials not configured/i);
  });

  it("echo skip: assigneeId mapping matches externalAssigneeLogins → no action scheduled", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const aliceUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Alice" });
      await ctx.db.insert("workspaceMembers", { userId: uid, workspaceId, role: WorkspaceRole.MEMBER });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: uid, provider: "github", externalLogin: "alice",
      });
      return uid;
    });

    const { taskId, linkId } = await t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        projectId, workspaceId, status: "active", pausedByBilling: false,
        externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500",
        order: 0, isDefault: true, isCompleted: false,
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId,
        title: "Echo skip", statusId, priority: "medium", completed: false,
        creatorId: botUserId, assigneeId: aliceUserId,
        externalRefs: [{ provider: "github", repoFullName: "acme/web", issueNumber: 42, url: "https://github.com/acme/web/issues/42" }],
      });
      const linkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1", externalUpdatedAt: 1_000,
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://github.com/octocat" },
        externalState: "open",
        externalAssigneeLogins: ["alice"], // GitHub already has alice
      });
      return { taskId, linkId };
    });

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await readLastSyncError(t, linkId)).toBeUndefined();
  });

  it("bot-user assignee contributes no GitHub login → push is a no-op (no clearing)", async () => {
    // When the inbound bot-user fallback fires, the task ends up assigned to
    // the integration's bot. We must NOT then push a "clear all assignees"
    // back to GitHub — that would erase the real external assignees the
    // shadow chips render. Outbound treats the bot as "nothing to say."
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const { taskId, linkId } = await t.run(async (ctx) => {
      const botUserId = await ctx.db.insert("users", { name: "GitHub", isBot: true });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId, botUserId, provider: "github", externalAccountId: "install-1",
      });
      const projectLinkId = await ctx.db.insert("projectIntegrationLinks", {
        projectId, workspaceId, status: "active", pausedByBilling: false,
        externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
      });
      const statusId = await ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500",
        order: 0, isDefault: true, isCompleted: false,
      });
      const taskId = await ctx.db.insert("tasks", {
        projectId, workspaceId, title: "Bot assignee", statusId,
        priority: "medium", completed: false, creatorId: botUserId,
        assigneeId: botUserId, // ← inbound bot fallback assigned the bot
        externalRefs: [{ provider: "github", repoFullName: "acme/web", issueNumber: 42, url: "https://github.com/acme/web/issues/42" }],
      });
      const linkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId, projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1", externalUpdatedAt: 1_000,
        externalAuthor: { login: "octocat", avatarUrl: "u", url: "https://github.com/octocat" },
        externalState: "open",
        externalAssigneeLogins: ["external1", "external2"], // real GitHub assignees
      });
      return { taskId, linkId };
    });

    await t.run((ctx) => maybeEnqueueAssigneesPush(ctx, taskId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // No action scheduled → no permanent-fail recorded.
    expect(await readLastSyncError(t, linkId)).toBeUndefined();
    // externalAssigneeLogins preserved (no DELETE was sent).
    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalAssigneeLogins).toEqual(["external1", "external2"]);
  });

  it("recordLabelsSuccess writes nextLabels into externalLabels and clears lastSyncError", async () => {
    const t = createTestContext();
    const { taskId, linkId } = await setupLinkedTask(t, {
      taskLabels: ["bug", "good first issue"],
      externalLabels: [],
    });
    // Seed a prior failure so we can observe it being cleared on success.
    await t.run((ctx) =>
      ctx.db.patch(linkId, {
        lastSyncError: {
          occurredAt: 1_000,
          message: "earlier failure",
          httpStatus: 500,
        },
      }),
    );

    await t.mutation(
      internal.integrations.github.syncOutMutations.recordLabelsSuccess,
      { taskId, nextLabels: ["bug", "good first issue"] },
    );

    const link = await t.run((ctx) => ctx.db.get(linkId));
    expect(link?.externalLabels).toEqual(["bug", "good first issue"]);
    expect(link?.lastSyncError).toBeUndefined();
  });
});
