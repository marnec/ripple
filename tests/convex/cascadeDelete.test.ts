import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../../convex/dbTriggers";
import { cascadeDelete } from "../../convex/cascadeDelete";
import { auditLog } from "../../convex/auditLog";
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
      isPublic: false,
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
