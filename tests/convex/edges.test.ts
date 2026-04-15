import { expect, describe, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createTestContext,
  setupWorkspaceWithAdmin,
} from "./helpers";
import type { Id } from "../../convex/_generated/dataModel";
import { writerWithTriggers } from "convex-helpers/server/triggers";
import { triggers } from "../../convex/dbTriggers";

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

describe("edge nodeIds", () => {
  it("syncEdges populates sourceNodeId and targetNodeId", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    // Create resources with triggers so nodes exist
    const { documentId, diagramId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const docId = await db.insert("documents", { workspaceId, name: "Doc" });
      const diaId = await db.insert("diagrams", { workspaceId, name: "Dia" });
      return { documentId: docId, diagramId: diaId };
    });

    await asUser.mutation(api.edges.syncEdges, {
      sourceType: "document",
      sourceId: documentId,
      references: [{ targetType: "diagram", targetId: diagramId }],
      workspaceId,
    });

    const edge = await t.run(async (ctx) => {
      const edges = await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
      return edges[0];
    });

    expect(edge.sourceNodeId).toBeDefined();
    expect(edge.targetNodeId).toBeDefined();

    // Verify they point to the correct nodes
    const [sourceNode, targetNode] = await t.run(async (ctx) => {
      const s = edge.sourceNodeId ? await ctx.db.get(edge.sourceNodeId) : null;
      const tgt = edge.targetNodeId ? await ctx.db.get(edge.targetNodeId) : null;
      return [s, tgt] as const;
    });

    expect(sourceNode?.resourceId).toBe(documentId);
    expect(targetNode?.resourceId).toBe(diagramId);
  });

  it("createEdge populates sourceNodeId and targetNodeId for task dependencies", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { projectId, todoId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const pId = await db.insert("projects", {
        name: "Proj", color: "bg-blue-500", workspaceId, creatorId: userId, key: "P", taskCounter: 0,
      });
      const sId = await ctx.db.insert("taskStatuses", {
        projectId: pId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      return { projectId: pId, todoId: sId };
    });

    const [taskA, taskB] = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const a = await db.insert("tasks", {
        projectId, workspaceId, title: "A", statusId: todoId, priority: "medium", completed: false, creatorId: userId,
      });
      const b = await db.insert("tasks", {
        projectId, workspaceId, title: "B", statusId: todoId, priority: "medium", completed: false, creatorId: userId,
      });
      return [a, b] as const;
    });

    const edgeId = await asUser.mutation(api.edges.createEdge, {
      taskId: taskA,
      dependsOnTaskId: taskB,
      type: "blocks",
    });

    const edge = await t.run(async (ctx) => ctx.db.get(edgeId));
    expect(edge?.sourceNodeId).toBeDefined();
    expect(edge?.targetNodeId).toBeDefined();
  });

  it("belongs_to trigger populates sourceNodeId and targetNodeId", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);

    const { projectId, todoId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const pId = await db.insert("projects", {
        name: "Proj", color: "bg-blue-500", workspaceId, creatorId: userId, key: "P", taskCounter: 0,
      });
      const sId = await ctx.db.insert("taskStatuses", {
        projectId: pId, name: "Todo", color: "bg-gray-500", order: 0, isDefault: true, isCompleted: false,
      });
      return { projectId: pId, todoId: sId };
    });

    const taskId = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      return await db.insert("tasks", {
        projectId, workspaceId, title: "Task", statusId: todoId, priority: "medium", completed: false, creatorId: userId,
      });
    });

    const edge = await t.run(async (ctx) => {
      const edges = await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", taskId))
        .collect();
      return edges.find((e) => (e.edgeType as string) === "belongs_to");
    });

    expect(edge?.sourceNodeId).toBeDefined();
    expect(edge?.targetNodeId).toBeDefined();
  });

  it("syncMentionEdges populates sourceNodeId and targetNodeId for user mentions", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);

    const { documentId, mentionedUserId } = await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      const docId = await db.insert("documents", { workspaceId, name: "Doc" });
      const uId = await ctx.db.insert("users", { name: "Alice", email: "a@test.com" });
      // Add user as workspace member so they get a node
      await db.insert("workspaceMembers", {
        userId: uId, workspaceId, role: "member" as any,
      });
      return { documentId: docId, mentionedUserId: uId };
    });

    await asUser.mutation(api.edges.syncMentionEdges, {
      sourceType: "document",
      sourceId: documentId,
      mentionedUserIds: [mentionedUserId],
      workspaceId,
    });

    const edge = await t.run(async (ctx) => {
      const edges = await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", documentId))
        .collect();
      return edges.find((e) => e.edgeType === "mentions");
    });

    expect(edge?.sourceNodeId).toBeDefined();
    expect(edge?.targetNodeId).toBeDefined();
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
      workspaceId,
    });

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceType).toBe("document");
    expect(backlinks[0].sourceName).toBe("My Doc");
    expect(backlinks[0].edgeType).toBe("embeds");
  });

  it("should return empty for unauthenticated users", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);
    const backlinks = await t.query(api.edges.getBacklinks, {
      targetId: "someId",
      workspaceId,
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
      workspaceId,
    });

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourceType).toBe("document");
    expect(backlinks[0].sourceName).toBe("My Doc");
    expect(backlinks[0].edgeType).toBe("mentions");
  });
});

describe("channel mention edges (via messages trigger)", () => {
  async function setupChannel(
    t: ReturnType<typeof createTestContext>,
    opts: { workspaceId: Id<"workspaces">; name?: string },
  ) {
    return await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      return await db.insert("channels", {
        name: opts.name ?? "test-channel",
        workspaceId: opts.workspaceId,
        type: "open" as const,
      });
    });
  }

  function bodyWithUserMention(userId: string): string {
    return JSON.stringify([{
      type: "paragraph",
      content: [{ type: "userMention", props: { userId } }],
    }]);
  }

  function bodyWithTaskMention(taskId: string): string {
    return JSON.stringify([{
      type: "paragraph",
      content: [{ type: "taskMention", props: { taskId, taskTitle: "Test" } }],
    }]);
  }

  it("sending a message with a mention creates a channel→target edge", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });
    const mentionedUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
    );

    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-1",
      body: bodyWithUserMention(mentionedUserId),
      plainText: "@Alice",
      channelId,
    });

    const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
    const mentionEdges = edges.filter((e) => e.edgeType === "mentions");
    expect(mentionEdges).toHaveLength(1);
    expect(mentionEdges[0].sourceType).toBe("channel");
    expect(mentionEdges[0].sourceId).toBe(channelId);
    expect(mentionEdges[0].targetId).toBe(mentionedUserId);
  });

  it("second message with same mention in same channel creates a second edge row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });
    const mentionedUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Bob", email: "bob@test.com" }),
    );
    const body = bodyWithUserMention(mentionedUserId);

    await asUser.mutation(api.messages.send, { isomorphicId: "test-2a", body, plainText: "@Bob", channelId });
    await asUser.mutation(api.messages.send, { isomorphicId: "test-2b", body, plainText: "@Bob", channelId });

    const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
    const mentionEdges = edges.filter((e) => e.edgeType === "mentions");
    expect(mentionEdges).toHaveLength(2);
  });

  it("updating a message to remove a mention deletes one edge row", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });
    const mentionedUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Carol", email: "carol@test.com" }),
    );

    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-3",
      body: bodyWithUserMention(mentionedUserId),
      plainText: "@Carol",
      channelId,
    });

    const messageId = await t.run(async (ctx) => {
      const msgs = await ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect();
      return msgs[0]._id;
    });

    // Update message to remove mention
    await asUser.mutation(api.messages.update, {
      id: messageId,
      body: JSON.stringify([{ type: "paragraph", content: [] }]),
      plainText: "",
    });

    const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
    expect(edges.filter((e) => e.edgeType === "mentions")).toHaveLength(0);
  });

  it("soft-deleting a message removes its edge rows", async () => {
    const t = createTestContext();
    const { workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId });
    const mentionedUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Dave", email: "dave@test.com" }),
    );
    const body = bodyWithUserMention(mentionedUserId);

    // Two messages both mentioning the same user → 2 edge rows
    await asUser.mutation(api.messages.send, { isomorphicId: "test-4a", body, plainText: "@Dave", channelId });
    await asUser.mutation(api.messages.send, { isomorphicId: "test-4b", body, plainText: "@Dave", channelId });

    const messages = await t.run(async (ctx) =>
      ctx.db.query("messages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    );

    // Delete first message — one edge row removed, one survives
    await asUser.mutation(api.messages.remove, { id: messages[0]._id });
    const afterFirst = await t.run(async (ctx) => ctx.db.query("edges").collect());
    expect(afterFirst.filter((e) => e.edgeType === "mentions")).toHaveLength(1);

    // Delete second message — last edge row removed
    await asUser.mutation(api.messages.remove, { id: messages[1]._id });
    const afterSecond = await t.run(async (ctx) => ctx.db.query("edges").collect());
    expect(afterSecond.filter((e) => e.edgeType === "mentions")).toHaveLength(0);
  });

  it("channel backlinks show the channel name as sourceName", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const channelId = await setupChannel(t, { workspaceId, name: "engineering" });
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTask(t, { projectId, workspaceId, statusId: todoId, userId, title: "My Task" });

    await asUser.mutation(api.messages.send, {
      isomorphicId: "test-5",
      body: bodyWithTaskMention(taskId),
      plainText: "#My Task",
      channelId,
    });

    const backlinks = await asUser.query(api.edges.getBacklinks, { targetId: taskId, workspaceId });
    // Filter out belongs_to edges (task→project), keep only mentions
    const mentionBacklinks = backlinks.filter((b) => b.edgeType === "mentions");
    expect(mentionBacklinks).toHaveLength(1);
    expect(mentionBacklinks[0].sourceType).toBe("channel");
    expect(mentionBacklinks[0].sourceName).toBe("#engineering");
    expect(mentionBacklinks[0].edgeType).toBe("mentions");
  });
});

describe("task belongs_to edges (via trigger)", () => {
  /** Create a task through writerWithTriggers so all triggers fire. */
  async function createTaskWithTriggers(
    t: ReturnType<typeof createTestContext>,
    opts: { projectId: Id<"projects">; workspaceId: Id<"workspaces">; statusId: Id<"taskStatuses">; userId: Id<"users">; title: string },
  ) {
    return await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      return await db.insert("tasks", {
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
        title: opts.title,
        statusId: opts.statusId,
        priority: "medium",
        completed: false,
        creatorId: opts.userId,
      });
    });
  }

  it("creating a task creates a belongs_to edge to its project", async () => {
    const t = createTestContext();
    const { userId, workspaceId } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTaskWithTriggers(t, { projectId, workspaceId, statusId: todoId, userId, title: "My Task" });

    const edges = await t.run(async (ctx) =>
      ctx.db.query("edges").withIndex("by_source", (q) => q.eq("sourceId", taskId)).collect(),
    );
    const belongsTo = edges.filter((e) => (e.edgeType as string) === "belongs_to");
    expect(belongsTo).toHaveLength(1);
    expect(belongsTo[0].sourceType).toBe("task");
    expect(belongsTo[0].targetType).toBe("project");
    expect(belongsTo[0].targetId).toBe(projectId);
  });

  it("deleting a task removes its belongs_to edge", async () => {
    const t = createTestContext();
    const { userId, workspaceId, asUser } = await setupWorkspaceWithAdmin(t);
    const { projectId, todoId } = await setupProject(t, { workspaceId, userId });
    const taskId = await createTaskWithTriggers(t, { projectId, workspaceId, statusId: todoId, userId, title: "Doomed Task" });

    await asUser.mutation(api.tasks.remove, { taskId });

    const edges = await t.run(async (ctx) =>
      ctx.db.query("edges").withIndex("by_source", (q) => q.eq("sourceId", taskId)).collect(),
    );
    expect(edges.filter((e) => (e.edgeType as string) === "belongs_to")).toHaveLength(0);
  });
});

describe("user nodes (via workspaceMembers trigger)", () => {
  /** Add a member with triggers so user node is created. */
  async function addMemberWithTriggers(
    t: ReturnType<typeof createTestContext>,
    opts: { userId: Id<"users">; workspaceId: Id<"workspaces"> },
  ) {
    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.insert("workspaceMembers", {
        userId: opts.userId,
        workspaceId: opts.workspaceId,
        role: "member" as any,
      });
    });
  }

  it("adding a workspace member creates a user node", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const newUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
    );
    await addMemberWithTriggers(t, { userId: newUserId, workspaceId });

    const userNode = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", newUserId))
        .first(),
    );

    expect(userNode).not.toBeNull();
    expect(userNode!.resourceType).toBe("user");
    expect(userNode!.name).toBe("Alice");
    expect(userNode!.workspaceId).toBe(workspaceId);
  });

  it("removing a workspace member deletes the user node", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
    );
    await addMemberWithTriggers(t, { userId, workspaceId });

    // Remove the member via trigger
    const memberId = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("workspaceMembers")
        .withIndex("by_workspace_user", (q) =>
          q.eq("workspaceId", workspaceId).eq("userId", userId),
        )
        .first();
      return member!._id;
    });

    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.delete(memberId);
    });

    const userNode = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", userId))
        .first(),
    );

    expect(userNode).toBeNull();
  });

  it("updating a user's name syncs to their user nodes", async () => {
    const t = createTestContext();
    const { workspaceId } = await setupWorkspaceWithAdmin(t);

    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Alice", email: "alice@test.com" }),
    );
    await addMemberWithTriggers(t, { userId, workspaceId });

    // Rename the user via trigger
    await t.run(async (ctx) => {
      const db = writerWithTriggers(ctx, ctx.db, triggers);
      await db.patch(userId, { name: "Alice Updated" });
    });

    const userNode = await t.run(async (ctx) =>
      ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", userId))
        .first(),
    );

    expect(userNode!.name).toBe("Alice Updated");
  });
});
