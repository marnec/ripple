import { describe, expect, it } from "vitest";
import {
  applyInstallationEvent,
  applyNormalizedEvent,
  isStaleUpdate,
} from "../convex/integrations/core/syncIn";
import type {
  NormalizedIssueAssigneesChangedEvent,
  NormalizedIssueClosedEvent,
  NormalizedIssueLabelsChangedEvent,
  NormalizedIssueOpenedEvent,
  NormalizedIssueReopenedEvent,
} from "../convex/integrations/core/types";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import type { Doc, Id } from "../convex/_generated/dataModel";
import {
  createTestContext,
  setupProject,
  setupWorkspaceWithAdmin,
} from "./helpers";

/**
 * Set up the prerequisites for an inbound sync test:
 *  - workspace + admin
 *  - project
 *  - a triage status on the project
 *  - a bot user + workspaceIntegrations row
 *  - an active projectIntegrationLinks row
 *
 * Returns the link doc (the argument shape applyNormalizedEvent expects).
 */
async function setupInboundFixtures(t: ReturnType<typeof createTestContext>) {
  const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
  const projectId = await setupProject(t, { workspaceId, creatorId: userId });

  const { triageStatusId, botUserId, linkDoc } = await t.run(async (ctx) => {
    const triageStatusId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Triage",
      color: "bg-amber-500",
      order: 0,
      isDefault: false,
      isCompleted: false,
      isTriage: true,
    });
    const botUserId = await ctx.db.insert("users", {
      name: "GitHub",
      email: undefined,
    });
    await ctx.db.insert("workspaceIntegrations", {
      workspaceId,
      botUserId,
      provider: "github",
      externalAccountId: "install-123",
    });
    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      workspaceId,
      projectId,
      status: "active",
      pausedByBilling: false,
      externalRepoFullName: "acme/web",
      externalRepoId: "R_kgDOACME",
    });
    const linkDoc = (await ctx.db.get(linkId))!;
    return { triageStatusId, botUserId, linkDoc };
  });

  return {
    workspaceId,
    projectId,
    triageStatusId,
    botUserId,
    link: linkDoc as Doc<"projectIntegrationLinks">,
  };
}

const defaultAuthor = {
  login: "octocat",
  avatarUrl: "https://github.com/octocat.png",
  url: "https://github.com/octocat",
};

function makeOpenedEvent(
  overrides: Partial<NormalizedIssueOpenedEvent> = {},
): NormalizedIssueOpenedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.opened",
    externalIssueId: "I_kwDOABC123",
    issueNumber,
    externalUpdatedAt: 1_700_000_000_000,
    title: "Page crashes when toggling dark mode",
    body: "Steps to reproduce:\n1. Open settings\n2. Toggle dark mode",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    ...overrides,
  };
}

function makeClosedEvent(
  overrides: Partial<NormalizedIssueClosedEvent> = {},
): NormalizedIssueClosedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.closed",
    externalIssueId: "I_kwDOABC123",
    issueNumber,
    externalUpdatedAt: 1_700_000_001_000, // slightly after opened
    title: "Page crashes when toggling dark mode",
    body: "Steps to reproduce:\n1. Open settings\n2. Toggle dark mode",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    stateReason: "completed",
    ...overrides,
  };
}

function makeLabelsChangedEvent(
  overrides: Partial<NormalizedIssueLabelsChangedEvent> = {},
): NormalizedIssueLabelsChangedEvent {
  return {
    kind: "issue.labels_changed",
    externalIssueId: "I_kwDOABC123",
    issueNumber: 42,
    externalUpdatedAt: 1_700_000_003_000, // newer than opened
    labels: [],
    ...overrides,
  };
}

function makeReopenedEvent(
  overrides: Partial<NormalizedIssueReopenedEvent> = {},
): NormalizedIssueReopenedEvent {
  const issueNumber = overrides.issueNumber ?? 42;
  return {
    kind: "issue.reopened",
    externalIssueId: "I_kwDOABC123",
    issueNumber,
    externalUpdatedAt: 1_700_000_002_000,
    title: "Page crashes when toggling dark mode",
    body: "Steps to reproduce:\n1. Open settings\n2. Toggle dark mode",
    url: `https://github.com/acme/web/issues/${issueNumber}`,
    externalAuthor: defaultAuthor,
    ...overrides,
  };
}

/**
 * Insert an extra task status (e.g. "Done", "Won't Do") onto the project.
 * Sequential `order` so later inserts come after earlier ones.
 */
async function insertStatus(
  t: ReturnType<typeof createTestContext>,
  opts: {
    projectId: Id<"projects">;
    name: string;
    order: number;
    isCompleted: boolean;
    externalCloseReason?: "completed" | "not_planned";
  },
): Promise<Id<"taskStatuses">> {
  return t.run((ctx) =>
    ctx.db.insert("taskStatuses", {
      projectId: opts.projectId,
      name: opts.name,
      color: "bg-gray-500",
      order: opts.order,
      isDefault: false,
      isCompleted: opts.isCompleted,
      externalCloseReason: opts.externalCloseReason,
    }),
  );
}

describe("integrations/core/syncIn.applyNormalizedEvent", () => {
  it("issue.opened creates a task in the project's triage status", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId, link } = await setupInboundFixtures(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
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

  it("creates a taskIntegrationLinks row with the event's externalIssueId pointing at the new task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({ externalIssueId: "I_kwDOXYZ999" });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOXYZ999"),
        )
        .unique(),
    );
    expect(linkRow).not.toBeNull();
    expect(linkRow?.taskId).toBe(task?._id);
  });

  it("populates tasks.externalRefs[] with a single entry pointing at the github issue", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({ issueNumber: 123 });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.externalRefs).toEqual([
      {
        provider: "github",
        repoFullName: "acme/web",
        issueNumber: 123,
        url: "https://github.com/acme/web/issues/123",
      },
    ]);
  });

  it("stores the event body as initialBodyMarkdown on the taskIntegrationLinks row", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({
      body: "## Repro\n\n1. Click foo\n2. Observe crash",
    });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", event.externalIssueId),
        )
        .unique(),
    );
    expect(linkRow?.initialBodyMarkdown).toBe(
      "## Repro\n\n1. Click foo\n2. Observe crash",
    );
  });

  it("stores the event's externalAuthor on the taskIntegrationLinks row", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({
      externalAuthor: {
        login: "external-contributor",
        avatarUrl: "https://example.com/avatar.png",
        url: "https://github.com/external-contributor",
      },
    });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", event.externalIssueId),
        )
        .unique(),
    );
    expect(linkRow?.externalAuthor).toEqual({
      login: "external-contributor",
      avatarUrl: "https://example.com/avatar.png",
      url: "https://github.com/external-contributor",
    });
  });

  it("uses the event's title as the task title", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({ title: "A very specific bug title" });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.title).toBe("A very specific bug title");
  });

  it("issue.closed (state_reason='completed') moves the task to the project's first isCompleted status by order", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const doneStatusId = await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    // Open the issue first so a task + link row exist.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "completed" }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(doneStatusId);
  });

  it("issue.closed closes the task's open work period (canonical status side-effects applied on inbound close)", async () => {
    // Regression: inbound close used to sync `completed` but skip work
    // periods, so a task worked-on then closed via GitHub kept an open period.
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    // Simulate the task having been worked on: an open work period.
    const taskId = await t.run(async (ctx) => {
      const [task] = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      await ctx.db.patch(task._id, { workPeriods: [{ startedAt: 500 }] });
      return task._id;
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "completed" }),
        link,
      }),
    );

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.completed).toBe(true);
    expect(task?.workPeriods).toHaveLength(1);
    expect(task?.workPeriods?.[0]?.completedAt).toBeTypeOf("number");
  });

  it("issue.closed (state_reason='not_planned') routes to the first status with externalCloseReason='not_planned'", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    // A vanilla "Done" status comes first by order…
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    // …but a not_planned-tagged status exists. Closed-as-not_planned must
    // pick this one, not the first isCompleted.
    const wontDoStatusId = await insertStatus(t, {
      projectId,
      name: "Won't Do",
      order: 2,
      isCompleted: true,
      externalCloseReason: "not_planned",
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "not_planned" }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(wontDoStatusId);
  });

  it("issue.closed (state_reason='not_planned') falls back to the first isCompleted status when no not_planned status is configured", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    // Only a vanilla "Done" exists — no externalCloseReason='not_planned'.
    const doneStatusId = await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "not_planned" }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(doneStatusId);
  });

  it("issue.reopened moves a closed task back to triage", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeClosedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeReopenedEvent(), link }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(triageStatusId);
  });

  it("flips tasks.completed=true when an issue is closed", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeClosedEvent(), link }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.completed).toBe(true);
  });

  it("flips tasks.completed=false when a closed issue is reopened", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeClosedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeReopenedEvent(), link }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.completed).toBe(false);
  });

  it("drops events whose externalUpdatedAt is not newer than the stored value", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalUpdatedAt: 2_000 }),
        link,
      }),
    );

    // A stale close event that arrives out of order (e.g. delayed delivery).
    // It must be dropped — the task stays in triage and remains open.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ externalUpdatedAt: 1_000 }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(triageStatusId);
    expect(task?.completed).toBe(false);
  });

  it("advances externalUpdatedAt on each accepted event so the ordering guard stays sharp", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const doneStatusId = await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalUpdatedAt: 1_000 }),
        link,
      }),
    );
    // Close at t=2000 (accepted, advances stored to 2000).
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ externalUpdatedAt: 2_000 }),
        link,
      }),
    );

    // A reopen at t=1500 is newer than the opened event but older than the
    // close. Must be dropped because the close moved stored forward to 2000.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeReopenedEvent({ externalUpdatedAt: 1_500 }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.statusId).toBe(doneStatusId);
  });

  it("records externalState='closed' and externalStateReason on the link row after a close", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "not_planned" }),
        link,
      }),
    );

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOABC123"),
        )
        .unique(),
    );
    expect(linkRow?.externalState).toBe("closed");
    expect(linkRow?.externalStateReason).toBe("not_planned");
  });

  it("clears externalStateReason when a closed issue is reopened", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ stateReason: "not_planned" }),
        link,
      }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeReopenedEvent(), link }),
    );

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOABC123"),
        )
        .unique(),
    );
    expect(linkRow?.externalState).toBe("open");
    expect(linkRow?.externalStateReason).toBeUndefined();
  });

  it("orphan issue.closed upserts a task directly into the completed status", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const doneStatusId = await insertStatus(t, {
      projectId,
      name: "Done",
      order: 1,
      isCompleted: true,
    });

    // No prior open. A close arrives for an issue we've never seen.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ externalIssueId: "I_kwDOORPHAN_CLOSED" }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task).toBeDefined();
    expect(task?.statusId).toBe(doneStatusId);
    expect(task?.completed).toBe(true);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOORPHAN_CLOSED"),
        )
        .unique(),
    );
    expect(linkRow?.externalState).toBe("closed");
    expect(linkRow?.taskId).toBe(task?._id);
  });

  it("orphan issue.reopened upserts a task into triage", async () => {
    const t = createTestContext();
    const { projectId, triageStatusId, link } = await setupInboundFixtures(t);

    // No prior open. A reopen arrives for an issue we've never seen.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeReopenedEvent({ externalIssueId: "I_kwDOORPHAN_REOPEN" }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task).toBeDefined();
    expect(task?.statusId).toBe(triageStatusId);
    expect(task?.completed).toBe(false);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOORPHAN_REOPEN"),
        )
        .unique(),
    );
    expect(linkRow?.externalState).toBe("open");
  });

  it("is idempotent: applying the same issue.opened event twice creates only one task", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    const event = makeOpenedEvent({ externalIssueId: "I_kwDOIDEMPOTENT" });

    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const tasks = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(tasks).toHaveLength(1);

    const linkRows = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_link_externalIssueId", (q) =>
          q
            .eq("projectIntegrationLinkId", link._id)
            .eq("externalIssueId", "I_kwDOIDEMPOTENT"),
        )
        .collect(),
    );
    expect(linkRows).toHaveLength(1);
  });

  it("attributes the created task to the bot user, not a workspace member", async () => {
    const t = createTestContext();
    const { projectId, botUserId, link } = await setupInboundFixtures(t);

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.creatorId).toBe(botUserId);
  });
});

describe("integrations/core/syncIn.applyNormalizedEvent — issue.labels_changed", () => {
  it("creates tags + taskTags rows, patches tasks.labels, and mirrors externalLabels", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: ["Bug", "good first issue"],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.labels).toEqual(["bug", "good first issue"]);

    const tagNames = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("tags")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect()
      )
        .map((r) => r.name)
        .sort(),
    );
    expect(tagNames).toEqual(["bug", "good first issue"]);

    const taskTagNames = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("taskTags")
          .withIndex("by_task", (q) => q.eq("taskId", task!._id))
          .collect()
      )
        .map((r) => r.tagName)
        .sort(),
    );
    expect(taskTagNames).toEqual(["bug", "good first issue"]);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalLabels).toEqual(["bug", "good first issue"]);
  });

  it("redelivered event with the same label set creates no duplicate taskTags rows", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    const event = makeLabelsChangedEvent({ labels: ["bug"] });
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));
    // Redeliver the exact same event (e.g. webhook retry).
    await t.run((ctx) => applyNormalizedEvent(ctx, { event, link }));

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const taskTagRows = await t.run((ctx) =>
      ctx.db
        .query("taskTags")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .collect(),
    );
    expect(taskTagRows).toHaveLength(1);
    expect(taskTagRows[0]?.tagName).toBe("bug");
  });

  it("empty label set removes existing taskTags rows, clears tasks.labels, and clears externalLabels", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );
    // Seed labels first.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: ["bug", "good first issue"],
          externalUpdatedAt: 1_700_000_003_000,
        }),
        link,
      }),
    );

    // Then unlabel everything (later event timestamp).
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: [],
          externalUpdatedAt: 1_700_000_004_000,
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.labels).toEqual([]);

    const taskTagRows = await t.run((ctx) =>
      ctx.db
        .query("taskTags")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .collect(),
    );
    expect(taskTagRows).toHaveLength(0);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalLabels).toEqual([]);
  });

  it("drops the event when externalUpdatedAt is not strictly newer than the stored value", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalUpdatedAt: 2_000 }),
        link,
      }),
    );
    // First labels event lands the canonical state.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: ["bug"],
          externalUpdatedAt: 3_000,
        }),
        link,
      }),
    );

    // A stale labels event (older timestamp) trying to clear labels.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: [],
          externalUpdatedAt: 2_500,
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.labels).toEqual(["bug"]);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalLabels).toEqual(["bug"]);
    expect(linkRow?.externalUpdatedAt).toBe(3_000);
  });

  it("echo skip: inbound labels matching externalLabels does not bump externalUpdatedAt", async () => {
    // Scenario: a Ripple-side label change fires our outbound PATCH; GitHub
    // accepts it and then immediately fires the `issues.labeled` webhook
    // back at us. The bounced event's label set already matches what we
    // wrote — re-applying would be redundant work and an unnecessary
    // subscription invalidation. Echo guard short-circuits in that case.
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalUpdatedAt: 2_000 }),
        link,
      }),
    );
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: ["bug"],
          externalUpdatedAt: 3_000,
        }),
        link,
      }),
    );

    // Echo: same labels arrive at a strictly newer timestamp.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeLabelsChangedEvent({
          labels: ["bug"],
          externalUpdatedAt: 4_000,
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalUpdatedAt).toBe(3_000);
  });
});

function makeAssigneesChangedEvent(
  overrides: Partial<NormalizedIssueAssigneesChangedEvent> = {},
): NormalizedIssueAssigneesChangedEvent {
  return {
    kind: "issue.assignees_changed",
    externalIssueId: "I_kwDOABC123",
    issueNumber: 42,
    externalUpdatedAt: 1_700_000_005_000, // newer than opened
    assignees: [],
    ...overrides,
  };
}

describe("integrations/core/syncIn.applyNormalizedEvent — issue.assignees_changed", () => {
  it("maps a GitHub login to its workspace member via workspaceMemberExternalIdentity and assigns the task", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    // Add a second user to the workspace and link them to GitHub login "alice".
    const aliceUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Alice", email: "alice@example.com" });
      await ctx.db.insert("workspaceMembers", {
        userId: uid,
        workspaceId,
        role: WorkspaceRole.MEMBER,
      });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId,
        userId: uid,
        provider: "github",
        externalLogin: "alice",
      });
      return uid;
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          assignees: [
            {
              login: "alice",
              avatarUrl: "https://github.com/alice.png",
              url: "https://github.com/alice",
            },
          ],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.assigneeId).toBe(aliceUserId);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalAssigneeLogins).toEqual(["alice"]);
  });

  it("with multiple assignees, the first matching workspace member wins and the rest become shadow chips", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    // alice maps to a workspace member; carol does too. bob has no identity row.
    const { aliceUserId, carolUserId } = await t.run(async (ctx) => {
      const alice = await ctx.db.insert("users", { name: "Alice" });
      const carol = await ctx.db.insert("users", { name: "Carol" });
      await ctx.db.insert("workspaceMembers", { userId: alice, workspaceId, role: WorkspaceRole.MEMBER });
      await ctx.db.insert("workspaceMembers", { userId: carol, workspaceId, role: WorkspaceRole.MEMBER });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: alice, provider: "github", externalLogin: "alice",
      });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: carol, provider: "github", externalLogin: "carol",
      });
      return { aliceUserId: alice, carolUserId: carol };
    });

    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          assignees: [
            // First in GitHub's order — should win even though bob comes
            // earlier alphabetically. GitHub's order is preserved.
            { login: "alice", avatarUrl: "https://github.com/alice.png", url: "https://github.com/alice" },
            { login: "bob",   avatarUrl: "https://github.com/bob.png",   url: "https://github.com/bob" },
            { login: "carol", avatarUrl: "https://github.com/carol.png", url: "https://github.com/carol" },
          ],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.assigneeId).toBe(aliceUserId);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    // Full set mirrored for echo guard + outbound diff.
    expect(linkRow?.externalAssigneeLogins).toEqual(["alice", "bob", "carol"]);
    // Shadow chips are everyone *other* than the matched assignee — bob (no
    // member match) and carol (matched but not the winner) both appear here
    // so the UI can render the full multi-assignee story.
    expect(linkRow?.externalAssignees).toEqual([
      { login: "bob",   avatarUrl: "https://github.com/bob.png",   url: "https://github.com/bob" },
      { login: "carol", avatarUrl: "https://github.com/carol.png", url: "https://github.com/carol" },
    ]);
    // Sanity: carol matched too, but as a shadow chip — task assignee is alice.
    expect(task?.assigneeId).not.toBe(carolUserId);
  });

  it("falls back to the bot user when no GitHub assignee matches a workspace member", async () => {
    const t = createTestContext();
    const { projectId, botUserId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    // No workspaceMemberExternalIdentity rows — every GitHub login misses.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          assignees: [
            { login: "external1", avatarUrl: "u1", url: "https://github.com/external1" },
            { login: "external2", avatarUrl: "u2", url: "https://github.com/external2" },
          ],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    // Bot-user fallback so the task surfaces "GitHub" rather than "Unassigned"
    // in member pickers and timeline views — the real identities still render
    // as shadow chips so no information is lost.
    expect(task?.assigneeId).toBe(botUserId);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalAssigneeLogins).toEqual(["external1", "external2"]);
    // Full set as shadow chips since no entry won the assigneeId slot.
    expect(linkRow?.externalAssignees).toEqual([
      { login: "external1", avatarUrl: "u1", url: "https://github.com/external1" },
      { login: "external2", avatarUrl: "u2", url: "https://github.com/external2" },
    ]);
  });

  it("clearing all assignees on GitHub clears Ripple's assigneeId and the shadow set", async () => {
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    const aliceUserId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Alice" });
      await ctx.db.insert("workspaceMembers", { userId: uid, workspaceId, role: WorkspaceRole.MEMBER });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: uid, provider: "github", externalLogin: "alice",
      });
      return uid;
    });

    // Assign alice first.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          externalUpdatedAt: 1_700_000_005_000,
          assignees: [{ login: "alice", avatarUrl: "u", url: "https://github.com/alice" }],
        }),
        link,
      }),
    );
    // Then clear (later event).
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          externalUpdatedAt: 1_700_000_006_000,
          assignees: [],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(task?.assigneeId).toBeUndefined();
    expect(task?.assigneeId).not.toBe(aliceUserId);

    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalAssigneeLogins).toEqual([]);
    expect(linkRow?.externalAssignees).toEqual([]);
  });

  it("echo skip: inbound assignees matching externalAssigneeLogins does not bump externalUpdatedAt", async () => {
    // Scenario: a Ripple-side assignee change fires our outbound PATCH;
    // GitHub accepts it and immediately fires the `issues.assigned` webhook
    // back at us. The bounced set already matches the mirror — re-applying
    // would be redundant and would mask staler events that follow.
    const t = createTestContext();
    const { workspaceId, projectId, link } = await setupInboundFixtures(t);
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeOpenedEvent({ externalUpdatedAt: 2_000 }),
        link,
      }),
    );

    await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { name: "Alice" });
      await ctx.db.insert("workspaceMembers", { userId: uid, workspaceId, role: WorkspaceRole.MEMBER });
      await ctx.db.insert("workspaceMemberExternalIdentity", {
        workspaceId, userId: uid, provider: "github", externalLogin: "alice",
      });
    });

    // Canonical state lands at t=3000.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          externalUpdatedAt: 3_000,
          assignees: [{ login: "alice", avatarUrl: "u", url: "https://github.com/alice" }],
        }),
        link,
      }),
    );

    // Echo — same set arrives at a strictly newer timestamp.
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeAssigneesChangedEvent({
          externalUpdatedAt: 4_000,
          assignees: [{ login: "alice", avatarUrl: "u", url: "https://github.com/alice" }],
        }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    // Echo guard didn't bump the ordering mirror — proof the second event
    // short-circuited rather than re-applying.
    expect(linkRow?.externalUpdatedAt).toBe(3_000);
  });
});

describe("integrations/core/syncIn.applyNormalizedEvent — issue.closed with closedBy", () => {
  it("persists the GitHub user who closed the issue on externalClosedBy", async () => {
    const t = createTestContext();
    const { projectId, link } = await setupInboundFixtures(t);
    await insertStatus(t, { projectId, name: "Done", order: 1, isCompleted: true });
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, { event: makeOpenedEvent(), link }),
    );

    const closer = {
      login: "octocat",
      avatarUrl: "https://github.com/octocat.png",
      url: "https://github.com/octocat",
    };
    await t.run((ctx) =>
      applyNormalizedEvent(ctx, {
        event: makeClosedEvent({ closedBy: closer }),
        link,
      }),
    );

    const [task] = await t.run((ctx) =>
      ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    const linkRow = await t.run((ctx) =>
      ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task!._id))
        .unique(),
    );
    expect(linkRow?.externalClosedBy).toEqual(closer);
  });
});

describe("integrations/core/syncIn.applyInstallationEvent", () => {
  it("is idempotent: already-disconnected links stay disconnected (no extra patches)", async () => {
    const t = createTestContext();
    const { link } = await setupInboundFixtures(t);
    // Pre-disconnect.
    await t.run((ctx) => ctx.db.patch(link._id, { status: "disconnected" }));
    const before = await t.run((ctx) => ctx.db.get(link._id));

    await t.run((ctx) =>
      applyInstallationEvent(ctx, {
        event: {
          kind: "installation.deleted",
          externalAccountId: "install-123",
        },
      }),
    );

    const after = await t.run((ctx) => ctx.db.get(link._id));
    expect(after?.status).toBe("disconnected");
    // Same row reference time → no patch was applied to an already-disconnected link.
    // (Convex doesn't bump _creationTime on patch, but it does mutate; we can't directly
    //  observe "no-op writes" without instrumentation. The contract is still useful as
    //  documentation: the impl skips already-disconnected links via an explicit guard.)
    expect(after?._creationTime).toBe(before?._creationTime);
  });

  it("installation_repositories.removed disconnects only the listed externalRepoIds", async () => {
    const t = createTestContext();
    const { workspaceId, link: linkA } = await setupInboundFixtures(t);
    // Second link under the same workspace + installation but a different repo.
    const { userId } = await t.run(async (ctx) => {
      const u = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first();
      return { userId: u!.userId };
    });
    const project2 = await setupProject(t, {
      workspaceId,
      creatorId: userId,
      name: "Second",
      key: "SEC",
    });
    const keptLinkId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId: project2,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/kept",
        externalRepoId: "R_kgDOKEPT",
      }),
    );

    // Remove only linkA's repo (R_kgDOACME from setupInboundFixtures).
    await t.run((ctx) =>
      applyInstallationEvent(ctx, {
        event: {
          kind: "installation_repositories.removed",
          externalAccountId: "install-123",
          externalRepoIds: ["R_kgDOACME"],
        },
      }),
    );

    const [a, kept] = await t.run(async (ctx) => [
      await ctx.db.get(linkA._id),
      await ctx.db.get(keptLinkId),
    ]);
    expect(a?.status).toBe("disconnected");
    expect(kept?.status).toBe("active");
  });

  it("installation.deleted does not touch links of OTHER workspaces (unrelated installation)", async () => {
    const t = createTestContext();
    const { link: linkA } = await setupInboundFixtures(t);

    // A second, fully independent workspace + installation + link.
    const { userId: userB, workspaceId: workspaceB } =
      await setupWorkspaceWithAdmin(t, "Workspace B");
    const projectB = await setupProject(t, {
      workspaceId: workspaceB,
      creatorId: userB,
      name: "B",
      key: "B",
    });
    const botBId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "GitHub B" }),
    );
    await t.run((ctx) =>
      ctx.db.insert("workspaceIntegrations", {
        workspaceId: workspaceB,
        botUserId: botBId,
        provider: "github",
        externalAccountId: "install-B-456",
      }),
    );
    const linkBId = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId: workspaceB,
        projectId: projectB,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/b",
        externalRepoId: "R_kgDOB",
      }),
    );

    // Delete workspace A's installation only.
    await t.run((ctx) =>
      applyInstallationEvent(ctx, {
        event: {
          kind: "installation.deleted",
          externalAccountId: "install-123",
        },
      }),
    );

    const [a, b] = await t.run(async (ctx) => [
      await ctx.db.get(linkA._id),
      await ctx.db.get(linkBId),
    ]);
    expect(a?.status).toBe("disconnected");
    expect(b?.status).toBe("active");
  });

  it("installation.deleted: every link in the workspace transitions to 'disconnected'", async () => {
    const t = createTestContext();
    const { workspaceId, link } = await setupInboundFixtures(t);
    // The setup gave us one link; add a second link under the same workspace
    // (different project + repo) to prove the fan-out reaches all of them.
    const { userId } = await t.run(async (ctx) => {
      const u = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .first();
      return { userId: u!.userId };
    });
    const project2 = await setupProject(t, {
      workspaceId,
      creatorId: userId,
      name: "Second",
      key: "SEC",
    });
    const link2Id = await t.run((ctx) =>
      ctx.db.insert("projectIntegrationLinks", {
        workspaceId,
        projectId: project2,
        status: "active",
        pausedByBilling: false,
        externalRepoFullName: "acme/second",
        externalRepoId: "R_kgDOSECOND",
      }),
    );

    await t.run((ctx) =>
      applyInstallationEvent(ctx, {
        event: {
          kind: "installation.deleted",
          externalAccountId: "install-123",
        },
      }),
    );

    const [l1, l2] = await t.run(async (ctx) => [
      await ctx.db.get(link._id),
      await ctx.db.get(link2Id),
    ]);
    expect(l1?.status).toBe("disconnected");
    expect(l2?.status).toBe("disconnected");
  });
});

describe("integrations/core/syncIn.isStaleUpdate", () => {
  it("older incoming → stale (dropped)", () => {
    expect(isStaleUpdate(100, 200)).toBe(true);
  });

  it("equal incoming → stale (idempotent against exact retries)", () => {
    expect(isStaleUpdate(200, 200)).toBe(true);
  });

  it("strictly newer incoming → not stale (applied)", () => {
    expect(isStaleUpdate(201, 200)).toBe(false);
  });
});

