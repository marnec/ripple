import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeReconciliationEvents } from "../convex/integrations/core/forceResync";
import { applyNormalizedEvent } from "../convex/integrations/core/syncIn";
import type { Doc } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
        const taskId = await ctx.db.insert("tasks", {
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
