import { TableAggregate } from "@convex-dev/aggregate";
import type { DataModel } from "./_generated/dataModel";
import { Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { Triggers } from "convex-helpers/server/triggers";
import { extractMessageTargets } from "./utils/blocknote";

// ── Aggregate definitions ───────────────────────────────────────────
// Each aggregate counts documents by workspaceId using O(log n) B-tree lookups.

export const documentsByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "documents";
}>(components.documentsByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const diagramsByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "diagrams";
}>(components.diagramsByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const spreadsheetsByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "spreadsheets";
}>(components.spreadsheetsByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const projectsByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "projects";
}>(components.projectsByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const channelsByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "channels";
}>(components.channelsByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const membersByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "workspaceMembers";
}>(components.membersByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

export const tasksByWorkspace = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "tasks";
}>(components.tasksByWorkspace, {
  namespace: (doc) => doc.workspaceId,
  sortKey: (doc) => doc._creationTime,
});

// ── Triggers ────────────────────────────────────────────────────────
// Auto-maintain aggregates and the nodes index whenever resource rows change.
// Multiple registrations per table stack — all handlers are called in sequence.

export const triggers = new Triggers<DataModel>();

// Aggregate triggers
triggers.register("documents", documentsByWorkspace.trigger());
triggers.register("diagrams", diagramsByWorkspace.trigger());
triggers.register("spreadsheets", spreadsheetsByWorkspace.trigger());
triggers.register("projects", projectsByWorkspace.trigger());
triggers.register("channels", channelsByWorkspace.trigger());
triggers.register("workspaceMembers", membersByWorkspace.trigger());
triggers.register("tasks", tasksByWorkspace.trigger());

// ── Nodes sync triggers ──────────────────────────────────────────────
// Keep the nodes table in sync on insert/update. Delete-time cleanup of
// nodes and edges is handled by cascade rules in cascadeDelete.ts.

async function syncNode(
  ctx: Parameters<Parameters<typeof triggers.register>[1]>[0],
  id: string,
  newName: string,
  newTags: string[],
  oldName: string,
  oldTags: string[],
) {
  if (newName === oldName && JSON.stringify(newTags) === JSON.stringify(oldTags)) return;
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource", (q) => q.eq("resourceId", id))
    .first();
  if (node) await ctx.db.patch(node._id, { name: newName, tags: newTags });
}

triggers.register("documents", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "document",
      resourceId: change.id,
      name: change.newDoc.name,
      tags: change.newDoc.tags ?? [],
    });
  } else if (change.operation === "update") {
    await syncNode(ctx, change.id,
      change.newDoc.name, change.newDoc.tags ?? [],
      change.oldDoc.name, change.oldDoc.tags ?? []);
  }
  // delete: node + edge cleanup handled by cascade rules
});

triggers.register("diagrams", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "diagram",
      resourceId: change.id,
      name: change.newDoc.name,
      tags: change.newDoc.tags ?? [],
    });
  } else if (change.operation === "update") {
    await syncNode(ctx, change.id,
      change.newDoc.name, change.newDoc.tags ?? [],
      change.oldDoc.name, change.oldDoc.tags ?? []);
  }
  // delete: node + edge cleanup handled by cascade rules
});

triggers.register("spreadsheets", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "spreadsheet",
      resourceId: change.id,
      name: change.newDoc.name,
      tags: change.newDoc.tags ?? [],
    });
  } else if (change.operation === "update") {
    await syncNode(ctx, change.id,
      change.newDoc.name, change.newDoc.tags ?? [],
      change.oldDoc.name, change.oldDoc.tags ?? []);
  }
  // delete: node + edge cleanup handled by cascade rules
});

triggers.register("projects", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "project",
      resourceId: change.id,
      name: change.newDoc.name,
      tags: change.newDoc.tags ?? [],
    });
  } else if (change.operation === "update") {
    await syncNode(ctx, change.id,
      change.newDoc.name, change.newDoc.tags ?? [],
      change.oldDoc.name, change.oldDoc.tags ?? []);
  }
  // delete: node + edge cleanup handled by cascade rules
});

triggers.register("channels", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "channel",
      resourceId: change.id,
      name: change.newDoc.name,
      tags: [],
    });
  } else if (change.operation === "update") {
    if (change.newDoc.name === change.oldDoc.name) return;
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", change.id))
      .first();
    if (node) await ctx.db.patch(node._id, { name: change.newDoc.name });
  }
  // delete: node + edge cleanup handled by cascade rules
});

triggers.register("tasks", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "task",
      resourceId: change.id,
      name: change.newDoc.title,
      tags: change.newDoc.labels ?? [],
    });
  } else if (change.operation === "update") {
    // Tasks are updated frequently (status, assignee, dates…) — only sync when
    // title or labels change to avoid unnecessary writes to the nodes table.
    const titleChanged = change.newDoc.title !== change.oldDoc.title;
    const labelsChanged =
      JSON.stringify(change.newDoc.labels ?? []) !== JSON.stringify(change.oldDoc.labels ?? []);
    if (!titleChanged && !labelsChanged) return;
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", change.id))
      .first();
    if (node) {
      await ctx.db.patch(node._id, {
        name: change.newDoc.title,
        tags: change.newDoc.labels ?? [],
      });
    }
  }
  // delete: node cleanup handled by cascade rules
});

// ── belongs_to edge triggers ─────────────────────────────────────────
// Keep task→project belongs_to edges in sync with the tasks table.

triggers.register("tasks", async (ctx, change) => {
  if (change.operation === "insert") {
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: change.id,
      targetType: "project",
      targetId: change.newDoc.projectId,
      edgeType: "belongs_to",
      workspaceId: change.newDoc.workspaceId,
      createdAt: Date.now(),
    });
  } else if (change.operation === "update") {
    if (change.newDoc.projectId === change.oldDoc.projectId) return;
    const old = await ctx.db
      .query("edges")
      .withIndex("by_source_target", (q) =>
        q.eq("sourceId", change.id).eq("targetId", change.oldDoc.projectId),
      )
      .first();
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: change.id,
      targetType: "project",
      targetId: change.newDoc.projectId,
      edgeType: "belongs_to",
      workspaceId: change.newDoc.workspaceId,
      createdAt: Date.now(),
    });
  }
  // delete: edge cleanup handled by cascade rules
});

// ── Channel mention edge helpers ────────────────────────────────────

type TriggerCtx = Parameters<Parameters<typeof triggers.register>[1]>[0];

async function insertChannelMentionEdge(
  ctx: TriggerCtx,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
  target: { targetType: "user" | "task" | "project" | "document" | "diagram" | "spreadsheet"; targetId: string },
) {
  await ctx.db.insert("edges", {
    sourceType: "channel",
    sourceId: channelId,
    targetType: target.targetType,
    targetId: target.targetId,
    edgeType: "mentions",
    workspaceId,
    createdAt: Date.now(),
  } as never);
}

async function deleteOneChannelMentionEdge(
  ctx: TriggerCtx,
  channelId: Id<"channels">,
  targetId: string,
) {
  const edges = await ctx.db
    .query("edges")
    .withIndex("by_source_target", (q) => q.eq("sourceId", channelId).eq("targetId", targetId))
    .collect();
  const edge = edges.find((e) => e.edgeType === "mentions");
  if (edge) await ctx.db.delete(edge._id);
}

// ── Messages trigger ─────────────────────────────────────────────────
// Maintains channel→target mention edges as messages are created, edited, or soft-deleted.
// Each message mention inserts one edge row; deletion removes one row. The graph
// deduplicates by (sourceId, targetId) at query time.

triggers.register("messages", async (ctx, change) => {
  const channelId = (change.newDoc ?? change.oldDoc).channelId;
  const channel = await ctx.db.get(channelId);
  if (!channel) return;
  const { workspaceId } = channel;

  if (change.operation === "insert") {
    if (change.newDoc.deleted) return;
    const targets = extractMessageTargets(change.newDoc.body);
    await Promise.all(targets.map((t) => insertChannelMentionEdge(ctx, channelId, workspaceId, t)));
  } else if (change.operation === "update") {
    const oldTargets = change.oldDoc.deleted ? [] : extractMessageTargets(change.oldDoc.body);
    const newTargets = change.newDoc.deleted ? [] : extractMessageTargets(change.newDoc.body);
    const oldIds = new Set(oldTargets.map((t) => t.targetId));
    const newIds = new Set(newTargets.map((t) => t.targetId));
    await Promise.all([
      ...newTargets.filter((t) => !oldIds.has(t.targetId)).map((t) => insertChannelMentionEdge(ctx, channelId, workspaceId, t)),
      ...oldTargets.filter((t) => !newIds.has(t.targetId)).map((t) => deleteOneChannelMentionEdge(ctx, channelId, t.targetId)),
    ]);
  }
});
