import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";

describe("integrations/taskLinks.getByTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setupLinkedTask(
    t: ReturnType<typeof createTestContext>,
    opts: {
      withLink: boolean;
      withError?: boolean;
      body?: string;
      snapshot?: boolean;
      edited?: boolean;
      seedStatus?: "pending" | "seeded" | "skipped" | "failed";
    } = { withLink: true },
  ) {
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

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
    const snapshotId = opts.snapshot
      ? await t.run((ctx) =>
          ctx.storage.store(
            new Blob([new Uint8Array([1, 2, 3])], {
              type: "application/octet-stream",
            }),
          ),
        )
      : undefined;
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "T",
        statusId,
        priority: "medium",
        completed: false,
        creatorId: userId,
        yjsSnapshotId: snapshotId,
        externalRefs: opts.withLink
          ? [
              {
                provider: "github",
                repoFullName: "acme/web",
                issueNumber: 42,
                url: "https://github.com/acme/web/issues/42",
              },
            ]
          : undefined,
      }),
    );

    let linkId: Id<"taskIntegrationLinks"> | undefined;
    if (opts.withLink) {
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
      linkId = await t.run((ctx) =>
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
          initialBodyMarkdown: opts.body,
          descriptionEdited: opts.edited,
          seedStatus: opts.seedStatus,
          ...(opts.withError && {
            lastSyncError: {
              occurredAt: 9_999,
              message: "HTTP 422 Unprocessable Entity",
              httpStatus: 422,
            },
          }),
        }),
      );
    }

    return { taskId, linkId, workspaceId, projectId, asUser };
  }

  it("returns null when the task has no integration link (Ripple-native)", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await setupLinkedTask(t, { withLink: false });

    const result = await asUser.query(
      api.integrations.core.taskLinks.getByTask,
      { taskId },
    );
    expect(result).toBeNull();
  });

  it("returns lastSyncError + externalIssueUrl when the link has a recorded failure", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await setupLinkedTask(t, {
      withLink: true,
      withError: true,
    });

    const result = await asUser.query(
      api.integrations.core.taskLinks.getByTask,
      { taskId },
    );
    expect(result).not.toBeNull();
    expect(result?.lastSyncError).toMatchObject({
      message: "HTTP 422 Unprocessable Entity",
      httpStatus: 422,
    });
    expect(result?.externalIssueUrl).toBe(
      "https://github.com/acme/web/issues/42",
    );
  });

  it("returns null for non-workspace members (soft gate, no data leak)", async () => {
    const t = createTestContext();
    const { taskId } = await setupLinkedTask(t, { withLink: true });
    // Different identity, not a member of the workspace.
    const outsider = t.withIdentity({
      subject: "stranger|test-session",
      issuer: "test",
      name: "Stranger",
      email: "stranger@example.com",
    });

    expect(
      await outsider.query(api.integrations.core.taskLinks.getByTask, { taskId }),
    ).toBeNull();
  });

  it("reports seedExpected only when a non-empty body was captured", async () => {
    const t = createTestContext();
    const withBody = await setupLinkedTask(t, { withLink: true, body: "Hello body" });
    const blankBody = await setupLinkedTask(t, { withLink: true, body: "   " });
    const noBody = await setupLinkedTask(t, { withLink: true });

    const r1 = await withBody.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: withBody.taskId });
    const r2 = await blankBody.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: blankBody.taskId });
    const r3 = await noBody.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: noBody.taskId });

    expect(r1?.seedExpected).toBe(true);
    expect(r2?.seedExpected).toBe(false);
    expect(r3?.seedExpected).toBe(false);
  });

  it("reports descriptionSnapshotId from the task's yjsSnapshotId", async () => {
    const t = createTestContext();
    const seeded = await setupLinkedTask(t, { withLink: true, body: "b", snapshot: true });
    const unseeded = await setupLinkedTask(t, { withLink: true, body: "b" });

    const r1 = await seeded.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: seeded.taskId });
    const r2 = await unseeded.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: unseeded.taskId });

    expect(r1?.descriptionSnapshotId).toBeTruthy();
    expect(r2?.descriptionSnapshotId).toBeNull();
  });

  it("surfaces descriptionEdited from the link", async () => {
    const t = createTestContext();
    const edited = await setupLinkedTask(t, { withLink: true, edited: true });
    const unedited = await setupLinkedTask(t, { withLink: true });

    const r1 = await edited.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: edited.taskId });
    const r2 = await unedited.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: unedited.taskId });

    expect(r1?.descriptionEdited).toBe(true);
    expect(r2?.descriptionEdited).toBeFalsy();
  });

  it("passes through seedStatus from the link (including undefined)", async () => {
    const t = createTestContext();
    const pending = await setupLinkedTask(t, { withLink: true, body: "b", seedStatus: "pending" });
    const seeded = await setupLinkedTask(t, { withLink: true, body: "b", seedStatus: "seeded" });
    const skipped = await setupLinkedTask(t, { withLink: true, body: "b", seedStatus: "skipped" });
    const failed = await setupLinkedTask(t, { withLink: true, body: "b", seedStatus: "failed" });
    const legacy = await setupLinkedTask(t, { withLink: true, body: "b" });

    const get = (s: Awaited<ReturnType<typeof setupLinkedTask>>) =>
      s.asUser.query(api.integrations.core.taskLinks.getByTask, { taskId: s.taskId });

    expect((await get(pending))?.seedStatus).toBe("pending");
    expect((await get(seeded))?.seedStatus).toBe("seeded");
    expect((await get(skipped))?.seedStatus).toBe("skipped");
    expect((await get(failed))?.seedStatus).toBe("failed");
    expect((await get(legacy))?.seedStatus).toBeUndefined();
  });
});

describe("tasks.markDescriptionEdited", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup(t: ReturnType<typeof createTestContext>, withLink: boolean) {
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });
    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId, workspaceId, title: "T", statusId, priority: "medium", completed: false, creatorId: userId,
      }),
    );
    let linkId: Id<"taskIntegrationLinks"> | undefined;
    if (withLink) {
      const projectLinkId = await t.run((ctx) =>
        ctx.db.insert("projectIntegrationLinks", {
          projectId, workspaceId, status: "active", pausedByBilling: false,
          externalRepoId: "R_kg1", externalRepoFullName: "acme/web",
        }),
      );
      linkId = await t.run((ctx) =>
        ctx.db.insert("taskIntegrationLinks", {
          taskId, projectIntegrationLinkId: projectLinkId, externalIssueId: "I_kg1",
          externalUpdatedAt: 1_000,
          externalAuthor: { login: "octocat", avatarUrl: "https://a/o.png", url: "https://github.com/octocat" },
        }),
      );
    }
    return { taskId, linkId, asUser };
  }

  it("sets descriptionEdited true on the link", async () => {
    const t = createTestContext();
    const { taskId, linkId, asUser } = await setup(t, true);
    await asUser.mutation(api.tasks.markDescriptionEdited, { taskId });
    const link = await t.run((ctx) => ctx.db.get(linkId!));
    expect(link?.descriptionEdited).toBe(true);
  });

  it("is idempotent (no write) once already set", async () => {
    const t = createTestContext();
    const { taskId, linkId, asUser } = await setup(t, true);
    await asUser.mutation(api.tasks.markDescriptionEdited, { taskId });
    const before = (await t.run((ctx) => ctx.db.get(linkId!)))!._creationTime;
    await asUser.mutation(api.tasks.markDescriptionEdited, { taskId });
    const after = await t.run((ctx) => ctx.db.get(linkId!));
    expect(after?.descriptionEdited).toBe(true);
    expect(after?._creationTime).toBe(before); // same row, no churn
  });

  it("no-ops for a Ripple-native task (no link)", async () => {
    const t = createTestContext();
    const { taskId, asUser } = await setup(t, false);
    await expect(
      asUser.mutation(api.tasks.markDescriptionEdited, { taskId }),
    ).resolves.toBeNull();
  });

  it("rejects non-workspace members", async () => {
    const t = createTestContext();
    const { taskId } = await setup(t, true);
    const outsider = t.withIdentity({
      subject: "stranger|s", issuer: "test", name: "S", email: "s@e.com",
    });
    await expect(
      outsider.mutation(api.tasks.markDescriptionEdited, { taskId }),
    ).rejects.toThrow();
  });
});

describe("tasks.retryOutboundSync", () => {
  // Same env-var trick as syncOut tests: with credentials unset, the
  // re-enqueued action records `lastSyncError` again. That's our observable
  // proof that retry actually re-triggers the outbound push.
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

  it("clears the existing lastSyncError and re-enqueues the outbound push", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const projectId = await setupProject(t, { workspaceId, creatorId: userId });

    const statusId = await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId,
        name: "Done",
        color: "bg-green-500",
        order: 0,
        isDefault: true,
        isCompleted: true,
      }),
    );
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", {
        projectId,
        workspaceId,
        title: "T",
        statusId,
        priority: "medium",
        completed: true,
        creatorId: userId,
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
    const linkId = await t.run((ctx) =>
      ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: projectLinkId,
        externalIssueId: "I_kg1",
        externalUpdatedAt: 1_000,
        externalAuthor: {
          login: "octocat",
          avatarUrl: "https://x.test/octocat.png",
          url: "https://github.com/octocat",
        },
        externalState: "open",
        lastSyncError: {
          occurredAt: 1_000,
          message: "old error",
          httpStatus: 422,
        },
      }),
    );

    await asUser.mutation(api.tasks.retryOutboundSync, { taskId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const link = await t.run((ctx) => ctx.db.get(linkId));
    // After draining: action ran (env vars unset → records missing-creds
    // failure). The lastSyncError is set again, but with a *new* message
    // proving the dispatch path re-fired rather than leaving the old error in
    // place.
    expect(link?.lastSyncError).toBeDefined();
    expect(link?.lastSyncError?.message).not.toBe("old error");
    expect(link?.lastSyncError?.message).toMatch(/credentials not configured/i);
  });
});
