import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../../convex/workspaceAggregates";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Create a project with seeded statuses. */
async function setupProject(
  t: ReturnType<typeof createTestContext>,
  opts: { workspaceId: Id<"workspaces">; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Test Project",
      color: "bg-blue-500",
      workspaceId: opts.workspaceId,
      creatorId: opts.userId,
      key: "TST",
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

/** Create a task directly in the database. */
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
    return await ctx.db.insert("tasks", {
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      title: opts.title ?? "Test Task",
      statusId: opts.statusId,
      priority: "medium",
      completed: false,
      creatorId: opts.userId,
    });
  });
}

describe("edges.syncEdges", () => {
  it("should insert embed edges for new references", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    // Create a document and diagram
    const { documentId, diagramId } = await t.run(async (ctx) => {
      const docId = await ctx.db.insert("documents", {
        workspaceId,
        name: "Test Doc",
      });
      const diaId = await ctx.db.insert("diagrams", {
        workspaceId,
        name: "Test Diagram",
      });
      return { documentId: docId, diagramId: diaId };
    });

    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    // Verify edge was created
    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].sourceType).toBe("document");
    expect(edges[0].targetId).toBe(diagramId);
    expect(edges[0].edgeType).toBe("embeds");
  });

  it("should delete removed references on re-sync", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, diagramId } = await t.run(async (ctx) => {
      const docId = await ctx.db.insert("documents", { workspaceId, name: "Doc" });
      const diaId = await ctx.db.insert("diagrams", { workspaceId, name: "Dia" });
      return { documentId: docId, diagramId: diaId };
    });

    // First sync: add reference
    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    // Second sync: empty references (removed the embed)
    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [],
      workspaceId,
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(0);
  });

  it("should be idempotent on re-sync with same references", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, diagramId } = await t.run(async (ctx) => {
      const docId = await ctx.db.insert("documents", { workspaceId, name: "Doc" });
      const diaId = await ctx.db.insert("diagrams", { workspaceId, name: "Dia" });
      return { documentId: docId, diagramId: diaId };
    });

    const refs = [{ targetType: "diagram" as const, targetId: diagramId }];

    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: refs,
      workspaceId,
    });

    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: refs,
      workspaceId,
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(1);
  });
});

describe("edges.createEdge", () => {
  it("should create a task dependency edge", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });
    const taskB = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task B" });

    const edgeId = await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "blocks",
    });

    expect(edgeId).toBeDefined();

    const edge = await t.run(async (ctx) => ctx.db.get(edgeId));
    expect(edge?.sourceType).toBe("task");
    expect(edge?.sourceId).toBe(taskA);
    expect(edge?.targetId).toBe(taskB);
    expect(edge?.edgeType).toBe("blocks");
  });

  it("should prevent self-reference", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });

    await expect(
      asUser.mutation(api.edges.createEdge, {
        taskId: taskA,
        dependsOnTaskId: taskA,
        type: "blocks",
      }),
    ).rejects.toThrow("A task cannot depend on itself");
  });

  it("should prevent duplicate dependency", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });
    const taskB = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "B" });

    await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "blocks",
    });

    await expect(
      asUser.mutation(api.edges.createEdge, {
        taskId: taskA,
        dependsOnTaskId: taskB,
        type: "blocks",
      }),
    ).rejects.toThrow("Dependency already exists");
  });

  it("should prevent reverse relates_to duplicate", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });
    const taskB = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "B" });

    await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "relates_to",
    });

    await expect(
      asUser.mutation(api.edges.createEdge, {
        taskId: taskB,
        dependsOnTaskId: taskA,
        type: "relates_to",
      }),
    ).rejects.toThrow("Relationship already exists");
  });
});

describe("edges.removeEdge", () => {
  it("should remove a dependency edge", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId });
    const taskB = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "B" });

    const edgeId = await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "blocks",
    });

    await asUser.mutation(api.edges.removeEdge, { edgeId });

    const edge = await t.run(async (ctx) => ctx.db.get(edgeId));
    expect(edge).toBeNull();
  });
});

describe("edges.getBacklinks", () => {
  it("should return enriched backlinks for a target", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, diagramId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const docId = await db.insert("documents", { workspaceId, name: "My Doc" });
      const diaId = await db.insert("diagrams", { workspaceId, name: "My Diagram" });
      return { documentId: docId, diagramId: diaId };
    });

    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    const backlinks = await asUser.query(api.edges.getBacklinks, {
      targetId: diagramId,
    });

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceType).toBe("document");
    expect(backlinks[0].sourceName).toBe("My Doc");
    expect(backlinks[0].edgeType).toBe("embeds");
  });

  it("should return empty for unauthenticated users", async () => {
    const t = createTestContext();
    const backlinks = await t.query(api.edges.getBacklinks, {
      targetId: "someId",
    });
    expect(backlinks).toEqual([]);
  });
});

describe("edges.listByTask", () => {
  it("should group edges into blocks/blockedBy/relatesTo", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });

    const taskA = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task A" });
    const taskB = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task B" });
    const taskC = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "Task C" });

    // A blocks B
    await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "blocks",
    });

    // C blocks A (A is blocked by C)
    await asUser.mutation(api.edges.createEdge, {
      taskId: taskC,
      dependsOnTaskId: taskA,
      type: "blocks",
    });

    // A relates_to C
    await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskC,
      type: "relates_to",
    });

    const result = await asUser.query(api.edges.listByTask, { taskId: taskA });

    // A blocks B → "blocks" list contains B
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].task.title).toBe("Task B");

    // C blocks A → "blockedBy" list contains C
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0].task.title).toBe("Task C");

    // A relates_to C → "relatesTo" list contains C
    expect(result.relatesTo).toHaveLength(1);
    expect(result.relatesTo[0].task.title).toBe("Task C");
  });
});

describe("edges.syncMentionEdges", () => {
  it("should insert mention edges for mentioned users", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await t.run(async (ctx) => {
      return await ctx.db.insert("documents", { workspaceId, name: "Doc" });
    });

    // Create a second user to mention
    const mentionedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Mentioned User", email: "mentioned@test.com" });
    });

    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [mentionedUserId],
      workspaceId,
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].edgeType).toBe("mentions");
    expect(edges[0].targetType).toBe("user");
    expect(edges[0].targetId).toBe(mentionedUserId);
  });

  it("should remove mention edges when user is un-mentioned", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const documentId = await t.run(async (ctx) => {
      return await ctx.db.insert("documents", { workspaceId, name: "Doc" });
    });

    const mentionedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "User", email: "u@test.com" });
    });

    // Mention user
    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [mentionedUserId],
      workspaceId,
    });

    // Un-mention (empty array)
    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [],
      workspaceId,
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(0);
  });

  it("should not interfere with embed edges on the same source", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, diagramId, mentionedUserId } = await t.run(async (ctx) => {
      const docId = await ctx.db.insert("documents", { workspaceId, name: "Doc" });
      const diaId = await ctx.db.insert("diagrams", { workspaceId, name: "Dia" });
      const uId = await ctx.db.insert("users", { name: "User", email: "u@test.com" });
      return { documentId: docId, diagramId: diaId, mentionedUserId: uId };
    });

    // Sync embed edge
    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    // Sync mention edge
    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [mentionedUserId],
      workspaceId,
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(edges).toHaveLength(2);
    expect(edges.filter((e) => e.edgeType === "embeds")).toHaveLength(1);
    expect(edges.filter((e) => e.edgeType === "mentions")).toHaveLength(1);

    // Re-sync mentions with empty → should only remove mention edge, not embed
    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [],
      workspaceId,
    });

    const remaining = await t.run(async (ctx) => {
      return await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
    });

    expect(remaining).toHaveLength(1);
    expect(remaining[0].edgeType).toBe("embeds");
  });

  it("should show mention edges in getBacklinks", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, mentionedUserId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const docId = await db.insert("documents", { workspaceId, name: "My Doc" });
      const uId = await ctx.db.insert("users", { name: "Mentioned", email: "m@test.com" });
      return { documentId: docId, mentionedUserId: uId };
    });

    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [mentionedUserId],
      workspaceId,
    });

    // Query backlinks for the mentioned user
    const backlinks = await asUser.query(api.edges.getBacklinks, {
      targetId: mentionedUserId,
    });

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceType).toBe("document");
    expect(backlinks[0].sourceName).toBe("My Doc");
    expect(backlinks[0].edgeType).toBe("mentions");
  });
});

describe("message edges (via messages.send/update/remove)", () => {
  /** Helper to create a channel and return its ID. */
  async function setupChannel(
    t: ReturnType<typeof createTestContext>,
    opts: { workspaceId: Id<"workspaces">; name?: string },
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("channels", {
        name: opts.name ?? "test-channel",
        workspaceId: opts.workspaceId,
        isPublic: true,
      });
    });
  }

  /** Build a BlockNote JSON body with a user mention. */
  function bodyWithUserMention(userId: string): string {
    return JSON.stringify([{
      type: "paragraph",
      content: [{ type: "userMention", props: { userId } }],
    }]);
  }

  /** Build a BlockNote JSON body with a task mention. */
  function bodyWithTaskMention(taskId: string): string {
    return JSON.stringify([{
      type: "paragraph",
      content: [{ type: "taskMention", props: { taskId, taskTitle: "Test" } }],
    }]);
  }

  it("should create edges when sending a message with mentions", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });

    // Create a user to mention
    const mentionedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Alice", email: "alice@test.com" });
    });

    const body = bodyWithUserMention(mentionedUserId);
    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-1",
      body,
      plainText: "@Alice",
      channelId,
    });

    // Check edges
    const edges = await t.run(async (ctx) => {
      return await ctx.db.query("edges").collect();
    });

    const mentionEdges = edges.filter((e) => e.edgeType === "mentions" && e.sourceType === "message");
    expect(mentionEdges).toHaveLength(1);
    expect(mentionEdges[0].targetType).toBe("user");
    expect(mentionEdges[0].targetId).toBe(mentionedUserId);
    expect(mentionEdges[0].groupId).toBe(channelId);
  });

  it("should re-sync edges when message is updated", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "My Task" });

    // Send message with task mention
    const body1 = bodyWithTaskMention(taskId);
    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-2",
      body: body1,
      plainText: "#My Task",
      channelId,
    });

    // Get message ID
    const messageId = await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect();
      return msgs[0]._id;
    });

    // Update message to remove task mention and add user mention
    const mentionedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Bob", email: "bob@test.com" });
    });
    const body2 = bodyWithUserMention(mentionedUserId);

    await asUser.mutation(api.messages.update, {
      id: messageId,
      body: body2,
      plainText: "@Bob",
    });

    const edges = await t.run(async (ctx) => {
      return await ctx.db.query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", messageId))
        .collect();
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].targetType).toBe("user");
    expect(edges[0].targetId).toBe(mentionedUserId);
  });

  it("should remove edges when message is soft-deleted", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });

    const mentionedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", { name: "Carol", email: "carol@test.com" });
    });

    const body = bodyWithUserMention(mentionedUserId);
    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-3",
      body,
      plainText: "@Carol",
      channelId,
    });

    const messageId = await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect();
      return msgs[0]._id;
    });

    await asUser.mutation(api.messages.remove, { id: messageId });

    const edges = await t.run(async (ctx) => {
      return await ctx.db.query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", messageId))
        .collect();
    });

    expect(edges).toHaveLength(0);
  });

  it("should show message backlinks with channel name", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, name: "engineering" });
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "My Task" });

    const body = bodyWithTaskMention(taskId);
    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-4",
      body,
      plainText: "#My Task",
      channelId,
    });

    const backlinks = await asUser.query(api.edges.getBacklinks, {
      targetId: taskId,
    });

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceType).toBe("message");
    expect(backlinks[0].sourceName).toBe("#engineering");
    expect(backlinks[0].edgeType).toBe("mentions");
    expect(backlinks[0].groupId).toBe(channelId);
  });
});
