import { TableAggregate } from "@convex-dev/aggregate";
import type { DataModel } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { Triggers } from "convex-helpers/server/triggers";

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
// Keep the nodes table in sync automatically. No need to call insertNode /
// updateNodeName / deleteNode manually in resource mutations — any write
// through writerWithTriggers fires these handlers.

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

async function deleteNodeForId(
  ctx: Parameters<Parameters<typeof triggers.register>[1]>[0],
  id: string,
) {
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource", (q) => q.eq("resourceId", id))
    .first();
  if (node) await ctx.db.delete(node._id);
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
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
  } else {
    await deleteNodeForId(ctx, change.id);
  }
});
