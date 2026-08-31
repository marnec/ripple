import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import {
  createTestContext,
  setupAuthenticatedUser,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../convex/_generated/dataModel";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../convex/dbTriggers";
import { cascadeDelete } from "../convex/cascadeDelete";
import { auditLog } from "../convex/auditLog";
import type { DeletionSummary } from "convex-cascading-delete";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ── Helpers ──────────────────────────────────────────────────────────

async function setupProject(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    const projectId = await db.insert("projects", {
      name: "Cascade Project",
      color: "bg-blue-500",
      workspaceId: opts.workspaceId,
      creatorId: opts.userId,
      key: "CSC",
      taskCounter: 0,
    });
    const todoId = await ctx.db.insert("taskStatuses", {
      projectId,
      name: "Todo",
      color: "bg-gray-500",
      order: 0,
      isDefault: true,
      isCompleted: false,
    });
    return { projectId, todoId };
  });
}

async function createTask(
  t: ReturnType<typeof createTestContext>,
  opts: {
    projectId: Id<"projects">;
    workspaceId: Id<"workspaces">;
    statusId: Id<"taskStatuses">;
    userId: Id<"users">;
    title?: string;
  },
) {
  return await t.run(async (ctx) => {
    const db = writerWithTriggers(ctx, ctx.db, triggers);
    return await db.insert("tasks", {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      title: opts.title ?? "Cascade Task",
      statusId: opts.statusId,
      priority: "medium",
      completed: false,
      creatorId: opts.userId,
    });
  });
}

/** Helper to count rows in a table matching an index condition. */
async function countByIndex<T extends string>(
  t: ReturnType<typeof createTestContext>,
  table: T,
  index: string,
  field: string,
  value: string,
): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await (ctx.db as any)
      .query(table)
      .withIndex(index, (q: any) => q.eq(field, value))
      .collect();
    return rows.length;
  });
}

// ── Project cascade ──────────────────────────────────────────────────

describe("cascade delete: projects.remove", () => {
  it("cascades through tasks, comments, cycles, statuses, edges, and nodes", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    // Create 2 tasks
    const taskId1 = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task 1" });
    const taskId2 = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task 2" });

    // Add a comment on task 1
    await t.run(async (ctx) => {
      await ctx.db.insert("taskComments", {
        taskId: taskId1,
        userId,
        body: "A comment",
        deleted: false,
      });
    });

    // Create a cycle and assign task 2
    const cycleId = await asUser.mutation(api.cycles.create, {
      projectId,
      workspaceId,
      name: "Sprint 1",
    });
    await asUser.mutation(api.cycles.addTask, { cycleId, taskId: taskId2 });

    // Add an edge targeting the project (simulating a mention)
    await t.run(async (ctx) => {
      await ctx.db.insert("edges", {
        sourceType: "channel",
        sourceId: "fake-channel-id",
        targetType: "project",
        targetId: projectId,
        edgeType: "mentions",
        workspaceId,
        createdAt: Date.now(),
      });
    });

    // Add project notification preference
    await t.run(async (ctx) => {
      await ctx.db.insert("projectNotificationPreferences", {
        userId,
        projectId,
        taskAssigned: true,
        taskDescriptionMention: true,
        taskCommentMention: true,
        taskComment: true,
        taskStatusChange: true,
      });
    });

    // Verify everything exists before deletion
    expect(await countByIndex(t, "tasks", "by_project", "projectId", projectId)).toBe(2);
    expect(await countByIndex(t, "taskComments", "by_task", "taskId", taskId1)).toBe(1);
    expect(await countByIndex(t, "cycleTasks", "by_cycle", "cycleId", cycleId)).toBe(1);
    expect(await countByIndex(t, "taskStatuses", "by_project", "projectId", projectId)).toBe(1);
    expect(await countByIndex(t, "edges", "by_target", "targetId", projectId)).toBeGreaterThanOrEqual(1);
    expect(await countByIndex(t, "projectNotificationPreferences", "by_project", "projectId", projectId)).toBe(1);

    // Verify nodes exist for tasks and project
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", taskId1)).toBe(1);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", taskId2)).toBe(1);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", projectId)).toBe(1);

    // ── Delete project ──
    await asUser.mutation(api.projects.remove, { id: projectId });

    // Project itself is gone
    const project = await t.run(async (ctx) => ctx.db.get(projectId));
    expect(project).toBeNull();

    // All tasks deleted
    expect(await countByIndex(t, "tasks", "by_project", "projectId", projectId)).toBe(0);

    // Task comments cascaded
    expect(await countByIndex(t, "taskComments", "by_task", "taskId", taskId1)).toBe(0);

    // Cycle tasks cascaded (via tasks→cycleTasks AND cycles→cycleTasks)
    expect(await countByIndex(t, "cycleTasks", "by_cycle", "cycleId", cycleId)).toBe(0);

    // Cycles deleted
    const cycle = await t.run(async (ctx) => ctx.db.get(cycleId));
    expect(cycle).toBeNull();

    // Task statuses deleted
    expect(await countByIndex(t, "taskStatuses", "by_project", "projectId", projectId)).toBe(0);

    // Edges targeting project deleted
    expect(await countByIndex(t, "edges", "by_target", "targetId", projectId)).toBe(0);

    // Notification preferences deleted
    expect(await countByIndex(t, "projectNotificationPreferences", "by_project", "projectId", projectId)).toBe(0);

    // Nodes for tasks and project deleted (now via cascade, not trigger)
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", taskId1)).toBe(0);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", taskId2)).toBe(0);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", projectId)).toBe(0);

    // Task edges (belongs_to) cleaned up
    expect(await countByIndex(t, "edges", "by_source", "sourceId", taskId1)).toBe(0);
    expect(await countByIndex(t, "edges", "by_source", "sourceId", taskId2)).toBe(0);
  });

  /**
   * A project's task fanout is unbounded (task imports accept a ~900KB CSV per
   * job with no per-project ceiling), and each task recurses into ten more
   * tables. Doing that in the calling transaction is what makes a large project
   * permanently undeletable: the write cap aborts the mutation and the same
   * abort recurs on every retry.
   *
   * convex-test does not enforce Convex's read/write caps, so no test can fail
   * for that reason directly. What this specifies instead is the mechanism that
   * raises the ceiling — the deletion must not all happen in the caller's
   * transaction — plus the invariant that deferring it still finishes the job.
   */
  it("defers a large project's cascade instead of doing it all in the caller's transaction", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    // Past the batch size, so a batched cascade cannot finish inline. Seeded
    // raw (no triggers) purely for speed — the cascade reads rows, not nodes.
    const TASK_COUNT = 2200;
    await t.run(async (ctx) => {
      for (let i = 0; i < TASK_COUNT; i++) {
        await ctx.db.insert("tasks", {
          projectId,
          workspaceId,
          title: `Bulk task ${i}`,
          statusId: todoId,
          priority: "medium" as const,
          completed: false,
          creatorId: userId,
          number: i + 1,
        });
      }
    });

    await asUser.mutation(api.projects.remove, { id: projectId });

    // The single-transaction cascade has already deleted every row by now.
    expect(
      await countByIndex(t, "tasks", "by_project", "projectId", projectId),
      "the cascade must not delete a whole large project inside the calling mutation",
    ).toBeGreaterThan(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // …and deferring it must still finish the job.
    expect(await countByIndex(t, "tasks", "by_project", "projectId", projectId)).toBe(0);
    expect(await countByIndex(t, "taskStatuses", "by_project", "projectId", projectId)).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.get(projectId))).toBeNull();
  }, 60000);

  /**
   * `projectIntegrationLinks` was listed under the `workspaces` rule but not
   * under `projects`, so deleting a project left the link row behind with its
   * status still `active` — and an active link is a live binding, not an inert
   * record. Two things follow from that, and the second one is why this is not
   * merely untidy:
   *
   *   - `createLink` refuses a new binding while any non-`disconnected` row
   *     exists for the repo, naming a project id that no longer resolves. The
   *     repo becomes permanently unlinkable through the UI.
   *   - `findLiveRepoLink` still resolves the orphan, so every later `issues.*`
   *     delivery for that repo passes the gates, patches `lastWebhookAt`, and
   *     then throws in `resolveTriageStatus` — the project's `taskStatuses`
   *     went with the cascade. A permanent per-delivery failure loop.
   */
  it("cascades into the repo link, its PRs and its task links, freeing the repo to be relinked", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });

    // `createLink` needs a triage status and an installed integration account.
    await t.run(async (ctx) => {
      await ctx.db.insert("taskStatuses", {
        projectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 1,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      });
      const botUserId = await ctx.db.insert("users", { name: "GitHub" });
      await ctx.db.insert("workspaceIntegrations", {
        workspaceId,
        botUserId,
        provider: "github",
        externalAccountId: "install-999",
      });
    });

    const linkId = await asUser.mutation(api.integrations.core.links.createLink, {
      projectId,
      workspaceId,
      externalAccountId: "install-999",
      externalRepoId: "repo-node-1",
      externalRepoFullName: "acme/web",
    });

    // One of everything hanging off the link.
    const { prId, taskLinkId } = await t.run(async (ctx) => {
      const prId = await ctx.db.insert("pullRequests", {
        workspaceId,
        projectIntegrationLinkId: linkId,
        provider: "github",
        externalPrId: "pr-node-1",
        number: 7,
        title: "Add the thing",
        url: "https://github.com/acme/web/pull/7",
        state: "open" as const,
        headRef: "feature",
        baseRef: "main",
        externalAuthor: { login: "octocat", avatarUrl: "", url: "" },
        externalUpdatedAt: Date.now(),
      });
      await ctx.db.insert("taskPullRequestLinks", { taskId, pullRequestId: prId });
      const taskLinkId = await ctx.db.insert("taskIntegrationLinks", {
        taskId,
        projectIntegrationLinkId: linkId,
        externalIssueId: "issue-node-1",
        externalUpdatedAt: Date.now(),
        externalAuthor: { login: "octocat", avatarUrl: "", url: "" },
      });
      return { prId, taskLinkId };
    });

    await asUser.mutation(api.projects.remove, { id: projectId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(linkId)), "the repo link must not outlive its project").toBeNull();
    expect(await t.run((ctx) => ctx.db.get(prId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(taskLinkId))).toBeNull();
    expect(await countByIndex(t, "taskPullRequestLinks", "by_pullRequest", "pullRequestId", prId)).toBe(0);

    // The observable that actually bit users: the repository is bindable again.
    const { projectId: nextProjectId } = await setupProject(t, { workspaceId, userId });
    await t.run((ctx) =>
      ctx.db.insert("taskStatuses", {
        projectId: nextProjectId,
        name: "Triage",
        color: "bg-amber-500",
        order: 0,
        isDefault: false,
        isCompleted: false,
        isTriage: true,
      }),
    );

    await expect(
      asUser.mutation(api.integrations.core.links.createLink, {
        projectId: nextProjectId,
        workspaceId,
        externalAccountId: "install-999",
        externalRepoId: "repo-node-1",
        externalRepoFullName: "acme/web",
      }),
      // Pre-fix this threw `Repository is already linked to project <deleted-id>`.
    ).resolves.toBeDefined();
  });
});

// ── Channel cascade ──────────────────────────────────────────────────

describe("cascade delete: channels.remove", () => {
  it("cascades through messages, reactions, members, notification prefs, edges, and nodes", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

    // Create a private channel via mutation (so triggers fire for node creation
    // and a channelMember is auto-created for the admin)
    const channelId = await asUser.mutation(api.channels.create, {
      name: "cascade-channel",
      workspaceId,
      visibility: "private" as const,
    });

    // Send a message to the channel
    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("messages", {
        channelId,
        userId,
        isomorphicId: "msg-cascade-1",
        body: "Hello cascade",
        plainText: "Hello cascade",
        deleted: false,
      });
    });

    // Add a reaction to the message
    await t.run(async (ctx) => {
      await ctx.db.insert("messageReactions", {
        messageId,
        userId,
        emoji: "1f44d",
        emojiNative: "👍",
      });
    });

    // Add channel notification preference
    await t.run(async (ctx) => {
      await ctx.db.insert("channelNotificationPreferences", {
        userId,
        channelId,
        chatMention: true,
        chatChannelMessage: true,
      });
    });

    // Verify pre-deletion state
    expect(await countByIndex(t, "messages", "by_channel", "channelId", channelId)).toBe(1);
    expect(await countByIndex(t, "messageReactions", "by_message", "messageId", messageId)).toBe(1);
    expect(await countByIndex(t, "channelMembers", "by_channel", "channelId", channelId)).toBeGreaterThanOrEqual(1);
    expect(await countByIndex(t, "channelNotificationPreferences", "by_channel", "channelId", channelId)).toBe(1);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", channelId)).toBe(1);

    // ── Delete channel ──
    await asUser.mutation(api.channels.remove, { id: channelId });

    // Channel gone
    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel).toBeNull();

    // Messages cascaded
    expect(await countByIndex(t, "messages", "by_channel", "channelId", channelId)).toBe(0);

    // Message reactions cascaded (messages→messageReactions)
    expect(await countByIndex(t, "messageReactions", "by_message", "messageId", messageId)).toBe(0);

    // Channel members cascaded
    expect(await countByIndex(t, "channelMembers", "by_channel", "channelId", channelId)).toBe(0);

    // Notification preferences cascaded
    expect(await countByIndex(t, "channelNotificationPreferences", "by_channel", "channelId", channelId)).toBe(0);

    // Node deleted (via cascade, not trigger)
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", channelId)).toBe(0);
  });
});

// ── Document cascade ─────────────────────────────────────────────────

describe("cascade delete: documents.remove", () => {
  it("cascades through blockRefs, edges, nodes, favorites, and recentActivity", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);

    // Create document via mutation (triggers fire for node creation)
    const documentId = await asUser.mutation(api.documents.create, {
      workspaceId,
      name: "Cascade Doc",
    });

    // Create a diagram to link to
    const diagramId = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      return await db.insert("diagrams", {
        workspaceId,
        name: "Target Diagram",
      });
    });

    // Add a block reference
    await t.run(async (ctx) => {
      await ctx.db.insert("documentBlockRefs", {
        documentId,
        blockId: "block-1",
        blockType: "heading",
        textContent: "Section A",
        updatedAt: Date.now(),
      });
    });

    // Add edges (outgoing embed + incoming reference)
    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    // Add a favorite
    await t.run(async (ctx) => {
      await ctx.db.insert("favorites", {
        userId,
        workspaceId,
        resourceType: "document",
        resourceId: documentId,
        favoritedAt: Date.now(),
      });
    });

    // Add recent activity
    await t.run(async (ctx) => {
      await ctx.db.insert("recentActivity", {
        userId,
        workspaceId,
        resourceType: "document",
        resourceId: documentId,
        resourceName: "Cascade Doc",
        visitedAt: Date.now(),
      });
    });

    // Verify pre-deletion state
    expect(await countByIndex(t, "documentBlockRefs", "by_document", "documentId", documentId)).toBe(1);
    expect(await countByIndex(t, "edges", "by_source", "sourceId", documentId)).toBe(1);
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", documentId)).toBe(1);
    expect(await countByIndex(t, "favorites", "by_resource_id", "resourceId", documentId)).toBe(1);
    expect(await countByIndex(t, "recentActivity", "by_resource_id", "resourceId", documentId)).toBe(1);

    // ── Delete document ──
    await asUser.mutation(api.documents.remove, { id: documentId });

    // Document gone
    const doc = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(doc).toBeNull();

    // Block refs cascaded
    expect(await countByIndex(t, "documentBlockRefs", "by_document", "documentId", documentId)).toBe(0);

    // Outgoing edges cascaded
    expect(await countByIndex(t, "edges", "by_source", "sourceId", documentId)).toBe(0);

    // Node deleted (via cascade, not trigger)
    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", documentId)).toBe(0);

    // Favorites cleaned up (new behavior)
    expect(await countByIndex(t, "favorites", "by_resource_id", "resourceId", documentId)).toBe(0);

    // Recent activity cleaned up (new behavior)
    expect(await countByIndex(t, "recentActivity", "by_resource_id", "resourceId", documentId)).toBe(0);
  });
});

// ── Audit log integration ────────────────────────────────────────────

describe("cascade delete: onComplete + audit log", () => {
  it("logs cascade summary to audit log via onComplete callback", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    // Create a task with a comment so the cascade has multiple levels
    const taskId = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });
    await t.run(async (ctx) => {
      await ctx.db.insert("taskComments", {
        taskId,
        userId,
        body: "Audit me",
        deleted: false,
      });
    });

    // Run cascade with onComplete that logs to audit log
    await t.run(async (ctx) => {
      await cascadeDelete.deleteWithCascade(ctx, "projects", projectId, {
        onComplete: async (ctx, summary: DeletionSummary) => {
          await auditLog.log(ctx, {
            action: "projects.cascade_deleted",
            actorId: userId,
            resourceType: "projects",
            resourceId: projectId,
            severity: "warning",
            metadata: summary,
            scope: workspaceId,
          });
        },
      });
    });

    // Query audit log for the cascade summary entry
    const logs = await t.run(async (ctx) => {
      return await auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: projectId,
      });
    });

    // Find the cascade_deleted entry
    const cascadeEntry = logs.find(
      (entry: { action: string }) => entry.action === "projects.cascade_deleted"
    );
    expect(cascadeEntry).toBeDefined();
    expect(cascadeEntry!.severity).toBe("warning");
    expect(cascadeEntry!.actorId).toBe(userId);
    expect(cascadeEntry!.scope).toBe(workspaceId);

    // Verify the metadata contains the cascade summary with expected tables
    const metadata = cascadeEntry!.metadata as Record<string, unknown>;
    expect(metadata.projects).toBe(1);
    expect(metadata.tasks).toBe(1);
    expect(metadata.taskComments).toBe(1);
    // taskStatuses, nodes, edges also deleted — just verify they're present
    expect(metadata.taskStatuses).toBeGreaterThanOrEqual(1);
    expect(metadata.nodes).toBeGreaterThanOrEqual(1);
  });
});

// ── Batched-mode failure alarm ───────────────────────────────────────
//
// `reconciliation.ts` names the `severity: "error"` audit entry as THE
// production alarm for a failed cascade. The batched onComplete used to
// filter on "how much got deleted" before it looked at `status`, so a cascade
// that failed before removing any child row wrote nothing at all — the one
// case the alarm exists for was the one it could not see.

describe("cascade delete: batched onComplete failure alarm", () => {
  async function runOnComplete(
    t: ReturnType<typeof createTestContext>,
    opts: {
      summary: Record<string, number>;
      status: string;
      userId: Id<"users">;
      projectId: Id<"projects">;
      workspaceId: Id<"workspaces">;
    },
  ) {
    await t.mutation(internal.cascadeDelete._batchCascadeOnComplete, {
      summary: JSON.stringify(opts.summary),
      status: opts.status,
      context: JSON.stringify({
        userId: opts.userId,
        resourceType: "projects",
        resourceId: opts.projectId,
        scope: opts.workspaceId,
      }),
    });

    const logs = await t.run(async (ctx) => {
      return await auditLog.queryByResource(ctx, {
        resourceType: "projects",
        resourceId: opts.projectId,
      });
    });
    return logs.filter(
      (entry: { action: string }) => entry.action === "projects.cascade_deleted",
    );
  }

  it("logs at severity error when the cascade failed before deleting any child row", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    // The first batch died: the summary carries the root table only (or, as
    // here, nothing beyond it), so `cascadedOnly` is empty.
    const entries = await runOnComplete(t, {
      summary: { projects: 1 },
      status: "failed",
      userId,
      projectId,
      workspaceId,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.severity).toBe("error");
  });

  it("still logs at severity error when a failed cascade did delete children", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    const entries = await runOnComplete(t, {
      summary: { projects: 1, tasks: 3 },
      status: "failed",
      userId,
      projectId,
      workspaceId,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.severity).toBe("error");
    expect(entries[0]!.metadata).toMatchObject({ tasks: 3 });
  });

  it("stays silent for a successful cascade that removed nothing but the root", async () => {
    const t = createTestContext();
    const { workspaceId, userId } = await setupWorkspaceWithAdmin(t);
    const { projectId } = await setupProject(t, { workspaceId, userId });

    // Noise filter, unchanged: a clean delete with no children is not worth
    // an audit entry.
    const entries = await runOnComplete(t, {
      summary: { projects: 1 },
      status: "completed",
      userId,
      projectId,
      workspaceId,
    });

    expect(entries).toHaveLength(0);
  });
});

// ── eventSeries ───────────────────────────────────────────────────────
//
// A series is a resource, so cancelling it is the same shape as cancelling a
// one-off event: the row goes, and the cascade takes everything filed under
// it. Past occurrences go with it — nothing of record is lost, because a call's
// transcript is a document and the trail is in the audit log, and both already
// outlive an event (spec 0003, "Deletion").

/** Tuesday 1 September 2026, 09:00–09:30 Rome — five Tuesdays in September. */
const WEEKLY_STANDUP = {
  title: "Standup",
  anchorDate: "2026-09-01",
  anchorTime: "09:00",
  durationMs: 30 * 60 * 1000,
  timezone: "Europe/Rome",
  rule: {
    freq: "weekly" as const,
    interval: 1,
    weekdays: ["tuesday"],
    end: { kind: "never" as const },
  },
};

const SEPTEMBER = {
  rangeStartMs: Date.parse("2026-09-01T00:00:00Z"),
  rangeEndMs: Date.parse("2026-10-01T00:00:00Z"),
};

describe("cascade delete: eventSeries.cancel", () => {
  it("removes every occurrence from the calendar", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    expect(
      await asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).toHaveLength(5);

    await asUser.mutation(api.eventSeries.cancel, { seriesId });

    expect(
      await asUser.query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).toEqual([]);
  });

  it("is refused to a colleague who is not the organizer, and to an outsider", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    const { userId: colleagueId, asUser: colleague } = await setupAuthenticatedUser(t, {
      email: "colleague@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", { workspaceId, userId: colleagueId, role: "member" }),
    );
    const { asUser: outsider } = await setupAuthenticatedUser(t, {
      email: "outsider@example.com",
    });

    await expect(colleague.mutation(api.eventSeries.cancel, { seriesId })).rejects.toThrow(
      /only the organizer/i,
    );
    await expect(outsider.mutation(api.eventSeries.cancel, { seriesId })).rejects.toThrow();

    // Still there, and still on the organizer's calendar.
    expect(
      await organizer.query(api.eventSeries.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).toHaveLength(5);
  });

  it("takes the overrides filed under it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // The second Tuesday, moved an hour later and renamed — an override row,
    // which is where a deleted series would otherwise leave an occurrence
    // standing on its own with no series to belong to.
    const secondTuesday = Date.parse("2026-09-08T07:00:00.000Z");
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: secondTuesday,
      title: "Standup (moved)",
      startsAt: secondTuesday + 60 * 60 * 1000,
      endsAt: secondTuesday + 90 * 60 * 1000,
    });
    expect(
      await countByIndex(t, "calendarEvents", "by_series_original_start", "seriesId", seriesId),
    ).toBe(1);

    await asUser.mutation(api.eventSeries.cancel, { seriesId });

    expect(
      await countByIndex(t, "calendarEvents", "by_series_original_start", "seriesId", seriesId),
    ).toBe(0);
    expect(
      await asUser.query(api.calendarEvents.listMineInRange, { workspaceId, ...SEPTEMBER }),
    ).toEqual([]);
  });

  it("takes the roster and the guests' share rows with it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser: organizer } = await setupWorkspaceWithAdmin(t);
    const { userId: colleagueId } = await setupAuthenticatedUser(t, {
      email: "colleague@example.com",
    });
    await t.run((ctx) =>
      ctx.db.insert("workspaceMembers", { workspaceId, userId: colleagueId, role: "member" }),
    );
    const seriesId = await organizer.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await organizer.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [colleagueId],
      guestEmails: ["guest@example.com"],
    });
    const shareId = (
      await organizer.query(api.eventSeries.listInvitees, { seriesId })
    ).find((r) => r.guestEmail === "guest@example.com")!.shareId!;

    await organizer.mutation(api.eventSeries.cancel, { seriesId });

    expect(
      await countByIndex(t, "eventSeriesInvitees", "by_series", "seriesId", seriesId),
    ).toBe(0);
    expect(
      await countByIndex(t, "resourceShares", "by_resource_id", "resourceId", seriesId),
    ).toBe(0);
    // The guest's link degrades to the ordinary "nothing here" landing rather
    // than erroring — a stale token is a normal thing to arrive with.
    expect((await t.query(api.eventSeries.getByShareId, { shareId })).status).toBe(
      "not_found",
    );
  });

  /**
   * Past occurrences go with the series, and that is the whole point of the
   * decision — but what a past call produced is a document of its own, and a
   * document outlives its event today. The session row is what carries the
   * pointer between the two, so removing it is what leaves the transcript
   * standing with nothing dangling at it.
   */
  it("leaves its calls' transcripts standing, with no link to the dead session", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // One finished call of the series, and the document its transcript was
    // ingested into. Seeded directly: the ingest path runs off a Cloudflare
    // webhook, and what this specifies is the deletion, not the ingest.
    const transcriptId = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const documentId = await db.insert("documents", {
        workspaceId,
        name: "Standup — 1 Sep",
        tags: ["transcript"],
      });
      await db.insert("callSessions", {
        seriesId,
        cloudflareMeetingId: "meeting-1",
        active: false,
        transcriptDocumentId: documentId,
        occurrenceStartMs: Date.parse("2026-09-01T07:00:00.000Z"),
      });
      return documentId;
    });

    await asUser.mutation(api.eventSeries.cancel, { seriesId });

    expect(await countByIndex(t, "callSessions", "by_series_active", "seriesId", seriesId)).toBe(0);
    expect(await asUser.query(api.documents.get, { id: transcriptId })).not.toBeNull();
    // Nothing anywhere still points at the transcript through a session that
    // no longer exists.
    expect(
      await countByIndex(
        t,
        "callSessions",
        "by_transcript_document",
        "transcriptDocumentId",
        transcriptId,
      ),
    ).toBe(0);
  });

  /**
   * The invariant: nothing in the polymorphic graph or the tag join outlives
   * the series it describes. A node whose resource is gone is a node the graph
   * still draws and `nodes.search` still offers, with nothing behind it.
   *
   * The series' node, its edges and its tag rows are written by the work that
   * makes a series a first-class resource (issue 07); until that lands this
   * assertion holds vacuously, and from the moment it lands this is the test
   * that stops the cascade forgetting them. The rules it guards are written
   * against `resourceId` / `sourceId` / `targetId` — plain string ids — so they
   * do not wait on a `resourceType` literal to exist.
   */
  it("leaves nothing in the graph or the tag join pointing at it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    await asUser.mutation(api.eventSeries.cancel, { seriesId });

    expect(await countByIndex(t, "nodes", "by_resource", "resourceId", seriesId)).toBe(0);
    expect(await countByIndex(t, "edges", "by_source", "sourceId", seriesId)).toBe(0);
    expect(await countByIndex(t, "edges", "by_target", "targetId", seriesId)).toBe(0);
    expect(
      await countByIndex(t, "channelMentionCounts", "by_target", "targetId", seriesId),
    ).toBe(0);
    expect(
      await countByIndex(t, "entityTags", "by_resource_id", "resourceId", seriesId),
    ).toBe(0);
  });

  it("goes with the workspace, along with everything filed under it", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });
    await asUser.mutation(api.eventSeries.updateOccurrence, {
      seriesId,
      originalStartMs: Date.parse("2026-09-08T07:00:00.000Z"),
      title: "Standup (moved)",
    });
    await asUser.mutation(api.eventSeries.addInvitees, {
      seriesId,
      userIds: [],
      guestEmails: ["guest@example.com"],
    });

    const { asUser: asAdmin } = await setupAuthenticatedUser(t, {
      name: "Platform Admin",
      email: "platform-admin@example.com",
    });
    await t.run(async (ctx) => {
      const admin = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), "platform-admin@example.com"))
        .unique();
      await ctx.db.patch(admin!._id, { isPlatformAdmin: true });
    });

    await asAdmin.mutation(api.admin.workspaces.remove, { workspaceId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(seriesId))).toBeNull();
    expect(
      await countByIndex(t, "eventSeries", "by_workspace_activeUntil", "workspaceId", workspaceId),
    ).toBe(0);
    // …and the workspace cascade recursed into the series' own children rather
    // than stopping at the series row.
    expect(
      await countByIndex(t, "eventSeriesInvitees", "by_series", "seriesId", seriesId),
    ).toBe(0);
    expect(
      await countByIndex(t, "calendarEvents", "by_series_original_start", "seriesId", seriesId),
    ).toBe(0);
    expect(
      await countByIndex(t, "resourceShares", "by_resource_id", "resourceId", seriesId),
    ).toBe(0);
  });

  /**
   * The ceiling, restated for the series. A long-lived series accumulates a row
   * per edited occurrence and a row per call it hosted, so its fanout grows
   * with its age rather than with its roster — and the workspace it belongs to
   * is deleted through the batched path precisely because a fanout like that
   * cannot be done in the caller's transaction. Adding the series to the
   * workspace's rules must not pull any of it back inline.
   *
   * As with the project version above: convex-test does not enforce Convex's
   * write cap, so what this specifies is the mechanism, plus the invariant that
   * deferring still finishes the job.
   */
  it("defers a long-lived series' fanout with the rest of the workspace cascade", async () => {
    const t = createTestContext();
    const { workspaceId, userId, asUser } = await setupWorkspaceWithAdmin(t);
    const seriesId = await asUser.mutation(api.eventSeries.create, {
      workspaceId,
      ...WEEKLY_STANDUP,
    });

    // Past the batch size. Seeded raw (no triggers) purely for speed — the
    // cascade reads rows, not nodes.
    const OVERRIDE_COUNT = 2200;
    await t.run(async (ctx) => {
      for (let i = 0; i < OVERRIDE_COUNT; i++) {
        const startsAt = Date.parse("2026-09-01T07:00:00.000Z") + i * 7 * 86_400_000;
        await ctx.db.insert("calendarEvents", {
          workspaceId,
          title: "Standup",
          startsAt,
          endsAt: startsAt + 30 * 60 * 1000,
          timezone: "Europe/Rome",
          createdBy: userId,
          seriesId,
          originalStartMs: startsAt,
        });
      }
    });

    const { asUser: asAdmin } = await setupAuthenticatedUser(t, {
      name: "Platform Admin",
      email: "platform-admin@example.com",
    });
    await t.run(async (ctx) => {
      const admin = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), "platform-admin@example.com"))
        .unique();
      await ctx.db.patch(admin!._id, { isPlatformAdmin: true });
    });

    await asAdmin.mutation(api.admin.workspaces.remove, { workspaceId });

    expect(
      await countByIndex(t, "calendarEvents", "by_series_original_start", "seriesId", seriesId),
      "the cascade must not delete a long-lived series inside the calling mutation",
    ).toBeGreaterThan(0);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(
      await countByIndex(t, "calendarEvents", "by_series_original_start", "seriesId", seriesId),
    ).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(seriesId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(workspaceId))).toBeNull();
  }, 60000);
});
