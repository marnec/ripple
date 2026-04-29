import { TableAggregate } from "@convex-dev/aggregate";
import { ConvexError } from "convex/values";
import type { DataModel } from "./_generated/dataModel";
import { Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { Triggers } from "convex-helpers/server/triggers";
import { extractMessageTargets } from "./utils/blocknote";
import {
  onChannelMemberInsert,
  onChannelMemberDelete,
  onChannelPreferencesChange,
} from "./notificationSubscriptionSync";

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
      metadata: { type: "task", projectId: change.newDoc.projectId },
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

// ── User nodes (via workspaceMembers) ──────────────────────────────
// One user node per workspace membership. Name synced from user profile.

triggers.register("workspaceMembers", async (ctx, change) => {
  if (change.operation === "insert") {
    const user = await ctx.db.get(change.newDoc.userId);
    await ctx.db.insert("nodes", {
      workspaceId: change.newDoc.workspaceId,
      resourceType: "user",
      resourceId: change.newDoc.userId,
      name: user?.name ?? user?.email ?? "Unknown",
      tags: [],
    });
  } else if (change.operation === "delete") {
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_resource_workspace", (q) =>
        q.eq("resourceId", change.oldDoc.userId).eq("workspaceId", change.oldDoc.workspaceId),
      )
      .first();
    if (node) await ctx.db.delete(node._id);
  }
});

// Sync user name/email changes to denormalized copies across the DB.
triggers.register("users", async (ctx, change) => {
  if (change.operation !== "update") return;

  const oldName = change.oldDoc.name ?? change.oldDoc.email ?? "Unknown";
  const newName = change.newDoc.name ?? change.newDoc.email ?? "Unknown";
  const nameChanged = oldName !== newName;
  const emailChanged = change.oldDoc.email !== change.newDoc.email;

  // User nodes — synced inline (small, bounded by workspace count)
  if (nameChanged) {
    const userNodes = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", change.id))
      .collect();
    await Promise.all(
      userNodes
        .filter((n) => n.resourceType === "user")
        .map((n) => ctx.db.patch(n._id, { name: newName })),
    );
  }

  // channelMembers denormalized name/email — offloaded via scheduler so the
  // originating mutation stays fast even if the user is in many channels.
  if (nameChanged || emailChanged) {
    await ctx.scheduler.runAfter(0, internal.userDenormalizationSync.syncToChannelMembers, {
      userId: change.id,
    });
  }
});

// ── Node ID lookup helper ───────────────────────────────────────────

type TriggerCtx = Parameters<Parameters<typeof triggers.register>[1]>[0];

async function findNodeId(ctx: TriggerCtx, resourceId: string) {
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource", (q) => q.eq("resourceId", resourceId))
    .first();
  return node?._id;
}

async function findUserNodeId(ctx: TriggerCtx, userId: string, workspaceId: Id<"workspaces">) {
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource_workspace", (q) =>
      q.eq("resourceId", userId).eq("workspaceId", workspaceId),
    )
    .first();
  return node?._id;
}

// ── belongs_to edge triggers ─────────────────────────────────────────
// Keep task→project belongs_to edges in sync with the tasks table.
// NOTE: This trigger MUST be registered after the task node trigger (line ~204)
// so that the task node exists when we look it up here.

triggers.register("tasks", async (ctx, change) => {
  if (change.operation === "insert") {
    const [sourceNodeId, targetNodeId] = await Promise.all([
      findNodeId(ctx, change.id),
      findNodeId(ctx, change.newDoc.projectId),
    ]);
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: change.id,
      targetType: "project",
      targetId: change.newDoc.projectId,
      edgeType: "belongs_to",
      workspaceId: change.newDoc.workspaceId,
      sourceNodeId,
      targetNodeId,
      createdAt: Date.now(),
    } as never);
  } else if (change.operation === "update") {
    if (change.newDoc.projectId === change.oldDoc.projectId) return;
    const old = await ctx.db
      .query("edges")
      .withIndex("by_source_target", (q) =>
        q.eq("sourceId", change.id).eq("targetId", change.oldDoc.projectId),
      )
      .first();
    if (old) await ctx.db.delete(old._id);
    const [sourceNodeId, targetNodeId] = await Promise.all([
      findNodeId(ctx, change.id),
      findNodeId(ctx, change.newDoc.projectId),
    ]);
    await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: change.id,
      targetType: "project",
      targetId: change.newDoc.projectId,
      edgeType: "belongs_to",
      workspaceId: change.newDoc.workspaceId,
      sourceNodeId,
      targetNodeId,
      createdAt: Date.now(),
    } as never);
  }
  // delete: edge cleanup handled by cascade rules
});

// ── Channel mention edge helpers ────────────────────────────────────

async function insertChannelMentionEdge(
  ctx: TriggerCtx,
  channelId: Id<"channels">,
  workspaceId: Id<"workspaces">,
  target: { targetType: "user" | "task" | "project" | "document" | "diagram" | "spreadsheet"; targetId: string },
) {
  const [sourceNodeId, targetNodeId] = await Promise.all([
    findNodeId(ctx, channelId),
    target.targetType === "user"
      ? findUserNodeId(ctx, target.targetId, workspaceId)
      : findNodeId(ctx, target.targetId),
  ]);
  await ctx.db.insert("edges", {
    sourceType: "channel",
    sourceId: channelId,
    targetType: target.targetType,
    targetId: target.targetId,
    edgeType: "mentions",
    workspaceId,
    sourceNodeId,
    targetNodeId,
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

// ── Tag uniqueness invariants ───────────────────────────────────────
// Convex has no DB-level unique constraints, so we enforce them in-trigger:
// throwing aborts the transaction and rolls back the offending write.
// Only fires for writes routed through writerWithTriggers (tagSync.ts).

triggers.register("tags", async (ctx, change) => {
  if (change.operation !== "insert" && change.operation !== "update") return;
  const { workspaceId, name } = change.newDoc;
  const same = await ctx.db
    .query("tags")
    .withIndex("by_workspace_name", (q) =>
      q.eq("workspaceId", workspaceId).eq("name", name),
    )
    .collect();
  if (same.some((t) => t._id !== change.id)) {
    throw new ConvexError(`Duplicate tag: "${name}" already exists in this workspace`);
  }
});

triggers.register("entityTags", async (ctx, change) => {
  if (change.operation !== "insert" && change.operation !== "update") return;
  const { resourceId, tagId } = change.newDoc;
  const same = await ctx.db
    .query("entityTags")
    .withIndex("by_resource_id", (q) => q.eq("resourceId", resourceId))
    .collect();
  if (same.some((et) => et.tagId === tagId && et._id !== change.id)) {
    throw new ConvexError(`Duplicate entityTag: tag is already attached to this resource`);
  }
});

// ── Notification subscription triggers ──────────────────────────────
// Maintain the notificationSubscriptions materialized view so that
// delivery queries are a single indexed lookup.

// ── Bulk operations: deferred to a separate transaction ─────────────
// In production, these schedule internal mutations via ctx.scheduler.runAfter(0)
// to avoid resource contention on user-facing mutations. The scheduled mutation
// runs in its own transaction immediately after the current one commits.
// In test environments (convex-test), run inline since the test framework
// doesn't automatically execute scheduled functions.

import {
  onWorkspaceMemberInsert,
  onWorkspaceMemberDelete,
  onPublicChannelInsert,
  onChannelMadePrivate,
  onChannelMadePublic,
  onGlobalPreferencesChange,
} from "./notificationSubscriptionSync";

const isTest = typeof process !== "undefined" && !!process.env?.VITEST;

triggers.register("workspaceMembers", async (ctx, change) => {
  if (change.operation === "insert") {
    if (isTest) {
      await onWorkspaceMemberInsert(ctx, change.newDoc.userId, change.newDoc.workspaceId);
    } else {
      await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.memberJoined, {
        userId: change.newDoc.userId,
        workspaceId: change.newDoc.workspaceId,
      });
    }
  } else if (change.operation === "delete") {
    if (isTest) {
      await onWorkspaceMemberDelete(ctx, change.oldDoc.userId, change.oldDoc.workspaceId);
    } else {
      await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.memberLeft, {
        userId: change.oldDoc.userId,
        workspaceId: change.oldDoc.workspaceId,
      });
    }
  }
});

triggers.register("channels", async (ctx, change) => {
  if (change.operation === "insert" && change.newDoc.type === "open") {
    if (isTest) {
      await onPublicChannelInsert(ctx, change.id as Id<"channels">, change.newDoc.workspaceId);
    } else {
      await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.publicChannelCreated, {
        channelId: change.id as Id<"channels">,
        workspaceId: change.newDoc.workspaceId,
      });
    }
  } else if (change.operation === "update") {
    const wasOpen = change.oldDoc.type === "open";
    const isOpen = change.newDoc.type === "open";
    if (wasOpen && !isOpen) {
      if (isTest) {
        await onChannelMadePrivate(ctx, change.id as Id<"channels">);
      } else {
        await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.channelMadePrivate, {
          channelId: change.id as Id<"channels">,
        });
      }
    } else if (!wasOpen && isOpen) {
      if (isTest) {
        await onChannelMadePublic(ctx, change.id as Id<"channels">, change.newDoc.workspaceId);
      } else {
        await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.channelMadePublic, {
          channelId: change.id as Id<"channels">,
          workspaceId: change.newDoc.workspaceId,
        });
      }
    }
  }
  // delete: handled by cascade rules in cascadeDelete.ts
});

triggers.register("notificationPreferences", async (ctx, change) => {
  if (change.operation === "insert") {
    if (isTest) {
      await onGlobalPreferencesChange(ctx, change.newDoc.userId, null, change.newDoc);
    } else {
      await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.globalPreferencesChanged, {
        userId: change.newDoc.userId,
        oldPrefs: undefined,
        newPrefs: change.newDoc,
      });
    }
  } else if (change.operation === "update") {
    if (isTest) {
      await onGlobalPreferencesChange(ctx, change.newDoc.userId, change.oldDoc, change.newDoc);
    } else {
      await ctx.scheduler.runAfter(0, internal.notificationSubscriptionJobs.globalPreferencesChanged, {
        userId: change.newDoc.userId,
        oldPrefs: change.oldDoc,
        newPrefs: change.newDoc,
      });
    }
  }
});

// ── Small operations: remain inline (constant-size, no contention) ──

triggers.register("channelMembers", async (ctx, change) => {
  if (change.operation === "insert") {
    await onChannelMemberInsert(
      ctx, change.newDoc.userId, change.newDoc.channelId, change.newDoc.workspaceId,
    );
  } else if (change.operation === "delete") {
    await onChannelMemberDelete(ctx, change.oldDoc.userId, change.oldDoc.channelId);
  }
});

triggers.register("channelNotificationPreferences", async (ctx, change) => {
  if (change.operation === "insert" || change.operation === "update") {
    const doc = change.newDoc;
    const channel = await ctx.db.get(doc.channelId);
    if (!channel) return;
    await onChannelPreferencesChange(
      ctx, doc.userId, doc.channelId, channel.workspaceId, doc,
    );
  }
});
