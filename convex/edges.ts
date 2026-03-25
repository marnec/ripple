import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { logTaskActivity } from "./auditLog";

// ── Validators ──────────────────────────────────────────────────────

const backlinkValidator = v.object({
  _id: v.id("edges"),
  sourceType: v.string(),
  sourceId: v.string(),
  sourceName: v.string(),
  edgeType: v.string(),
  workspaceId: v.string(),
  projectId: v.optional(v.string()),
});

const enrichedDepTaskValidator = v.object({
  _id: v.id("tasks"),
  title: v.string(),
  number: v.optional(v.number()),
  projectKey: v.optional(v.string()),
  completed: v.boolean(),
});

const depItemValidator = v.object({
  edgeId: v.id("edges"),
  task: enrichedDepTaskValidator,
});

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch and enrich references pointing to a target resource.
 * Shared between getBacklinks query and remove mutations.
 */
export async function getEnrichedBacklinks(
  ctx: GenericQueryCtx<DataModel>,
  targetId: string,
): Promise<Array<{
  _id: Id<"edges">;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
}>> {
  const edges = await ctx.db
    .query("edges")
    .withIndex("by_target", (q) => q.eq("targetId", targetId))
    .collect();

  return Promise.all(
    edges.map(async (edge) => {
      // Look up name via nodes table (all resource types are indexed there)
      const node = await ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", edge.sourceId))
        .first();
      let sourceName = node?.name;
      // Fallback for channels: look up directly if node not yet indexed
      if (!sourceName && edge.sourceType === "channel") {
        const channel = await ctx.db.get(edge.sourceId as Id<"channels">);
        sourceName = channel?.name ? `#${channel.name}` : undefined;
      }
      sourceName ??= `Deleted ${edge.sourceType}`;

      // Tasks need projectId for backlink display navigation
      let projectId: string | undefined;
      if (edge.sourceType === "task") {
        const task = await ctx.db.get(edge.sourceId as Id<"tasks">);
        projectId = task?.projectId;
      }

      return {
        _id: edge._id,
        sourceType: edge.sourceType as string,
        sourceId: edge.sourceId,
        sourceName,
        edgeType: edge.edgeType as string,
        workspaceId: edge.workspaceId as string,
        projectId,
      };
    }),
  );
}

// ── Sync (auto-tracked embeds) ──────────────────────────────────────

/**
 * Sync all hard-embed edges for a source (document or task).
 * Called by the client editor on content change (debounced).
 * Diffs against existing rows: deletes removed, inserts added.
 */
export const syncEdges = mutation({
  args: {
    sourceType: v.union(v.literal("document"), v.literal("task")),
    sourceId: v.string(),
    references: v.array(
      v.object({
        targetType: v.union(v.literal("diagram"), v.literal("spreadsheet"), v.literal("document")),
        targetId: v.string(),
      }),
    ),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, { sourceType, sourceId, references, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Access denied");

    // Get existing embed edges for this source
    const existing = await ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();

    // Only diff embed edges (not blocks/relates_to)
    const existingEmbeds = existing.filter((e) => e.edgeType === "embeds");
    const existingByTarget = new Map(
      existingEmbeds.map((r) => [r.targetId, r]),
    );
    const newTargetIds = new Set(references.map((r) => r.targetId));

    // Delete removed
    for (const edge of existingEmbeds) {
      if (!newTargetIds.has(edge.targetId)) {
        await ctx.db.delete(edge._id);
      }
    }

    // Insert added
    for (const ref of references) {
      if (!existingByTarget.has(ref.targetId)) {
        await ctx.db.insert("edges", {
          sourceType,
          sourceId,
          targetType: ref.targetType,
          targetId: ref.targetId,
          edgeType: "embeds",
          workspaceId,
          createdBy: userId,
          createdAt: Date.now(),
        });
      }
    }

    return null;
  },
});

/**
 * Sync mention edges for a source (document or task).
 * Called by the client editor on content change (debounced).
 * Diffs against existing mention edges: deletes removed, inserts added.
 */
export const syncMentionEdges = mutation({
  args: {
    sourceType: v.union(v.literal("document"), v.literal("task")),
    sourceId: v.string(),
    mentionedUserIds: v.array(v.string()),
    workspaceId: v.id("workspaces"),
  },
  returns: v.null(),
  handler: async (ctx, { sourceType, sourceId, mentionedUserIds, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Access denied");

    // Get existing mention edges for this source
    const existing = await ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();

    const existingMentions = existing.filter((e) => e.edgeType === "mentions");
    const existingByTarget = new Map(
      existingMentions.map((e) => [e.targetId, e]),
    );
    const newTargetIds = new Set(mentionedUserIds);

    // Delete removed
    for (const edge of existingMentions) {
      if (!newTargetIds.has(edge.targetId)) {
        await ctx.db.delete(edge._id);
      }
    }

    // Insert added
    for (const mentionedUserId of mentionedUserIds) {
      if (!existingByTarget.has(mentionedUserId)) {
        await ctx.db.insert("edges", {
          sourceType,
          sourceId,
          targetType: "user",
          targetId: mentionedUserId,
          edgeType: "mentions",
          workspaceId,
          createdBy: userId,
          createdAt: Date.now(),
        });
      }
    }

    return null;
  },
});

// ── Manual edges (task dependencies) ────────────────────────────────

/**
 * Create a manual edge between two tasks (blocks / relates_to).
 */
export const createEdge = mutation({
  args: {
    taskId: v.id("tasks"),
    dependsOnTaskId: v.id("tasks"),
    type: v.union(v.literal("blocks"), v.literal("relates_to")),
  },
  returns: v.id("edges"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Prevent self-reference
    if (args.taskId === args.dependsOnTaskId) {
      throw new ConvexError("A task cannot depend on itself");
    }

    // Auth: check workspace membership via source task
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new ConvexError("Task not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Check for duplicate (same direction)
    const existingEdges = await ctx.db
      .query("edges")
      .withIndex("by_source_target", (q) =>
        q.eq("sourceId", args.taskId).eq("targetId", args.dependsOnTaskId),
      )
      .collect();
    const existing = existingEdges.find(
      (e) => e.edgeType === args.type,
    );
    if (existing) throw new ConvexError("Dependency already exists");

    // For relates_to, also check reverse direction
    if (args.type === "relates_to") {
      const reverseEdges = await ctx.db
        .query("edges")
        .withIndex("by_source_target", (q) =>
          q.eq("sourceId", args.dependsOnTaskId).eq("targetId", args.taskId),
        )
        .collect();
      const reverse = reverseEdges.find((e) => e.edgeType === "relates_to");
      if (reverse) throw new ConvexError("Relationship already exists");
    }

    const edgeId = await ctx.db.insert("edges", {
      sourceType: "task",
      sourceId: args.taskId,
      targetType: "task",
      targetId: args.dependsOnTaskId,
      edgeType: args.type,
      workspaceId: task.workspaceId,
      createdBy: userId,
      createdAt: Date.now(),
    });

    // Log activity
    const targetTask = await ctx.db.get(args.dependsOnTaskId);
    await logTaskActivity(ctx, {
      taskId: args.taskId,
      userId,
      workspaceId: task.workspaceId,
      type: "dependency_add",
      newValue: `${args.type}:${targetTask?.title ?? "Unknown"}`,
      taskTitle: task.title,
    });

    return edgeId;
  },
});

/**
 * Remove a manual edge (task dependency).
 */
export const removeEdge = mutation({
  args: { edgeId: v.id("edges") },
  returns: v.null(),
  handler: async (ctx, { edgeId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const edge = await ctx.db.get(edgeId);
    if (!edge) throw new ConvexError("Edge not found");

    // Auth via source task's workspace
    const task = await ctx.db.get(edge.sourceId as Id<"tasks">);
    if (!task) throw new ConvexError("Task not found");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Log activity before deleting
    const targetTask = await ctx.db.get(edge.targetId as Id<"tasks">);
    await logTaskActivity(ctx, {
      taskId: edge.sourceId as Id<"tasks">,
      userId,
      workspaceId: task.workspaceId,
      type: "dependency_remove",
      oldValue: `${edge.edgeType}:${targetTask?.title ?? "Unknown"}`,
      taskTitle: task.title,
    });

    await ctx.db.delete(edgeId);
    return null;
  },
});

// ── Cascade cleanup ─────────────────────────────────────────────────

/**
 * Remove all outgoing edges from a source (when a document/task is deleted).
 */
export const removeAllForSource = internalMutation({
  args: { sourceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    await Promise.all(edges.map((e) => ctx.db.delete(e._id)));
    return null;
  },
});

/**
 * Remove all incoming edges to a target (when a diagram/spreadsheet/document is deleted).
 */
export const removeAllForTarget = internalMutation({
  args: { targetId: v.string() },
  returns: v.null(),
  handler: async (ctx, { targetId }) => {
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_target", (q) => q.eq("targetId", targetId))
      .collect();
    await Promise.all(edges.map((e) => ctx.db.delete(e._id)));
    return null;
  },
});

// ── Queries ─────────────────────────────────────────────────────────

/**
 * Get all backlinks pointing to a target resource, enriched with source names.
 * Powers the Backlinks component and DeleteWarningDialog.
 */
export const getBacklinks = query({
  args: {
    targetId: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  returns: v.array(backlinkValidator),
  handler: async (ctx, { targetId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return getEnrichedBacklinks(ctx, targetId);
  },
});

/**
 * List task dependency edges for a given task, grouped by type.
 * Replacement for taskDependencies.listByTask.
 */
export const listByTask = query({
  args: { taskId: v.id("tasks") },
  returns: v.object({
    blocks: v.array(depItemValidator),
    blockedBy: v.array(depItemValidator),
    relatesTo: v.array(depItemValidator),
  }),
  handler: async (ctx, { taskId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { blocks: [], blockedBy: [], relatesTo: [] };

    const task = await ctx.db.get(taskId);
    if (!task) return { blocks: [], blockedBy: [], relatesTo: [] };

    // Auth: workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", task.workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return { blocks: [], blockedBy: [], relatesTo: [] };

    // Query outgoing (sourceId = this task)
    const outgoing = await ctx.db
      .query("edges")
      .withIndex("by_source", (q) => q.eq("sourceId", taskId))
      .collect();

    // Query incoming (targetId = this task)
    const incoming = await ctx.db
      .query("edges")
      .withIndex("by_target", (q) => q.eq("targetId", taskId))
      .collect();

    // Filter to only task dependency edges
    const outgoingDeps = outgoing.filter(
      (e) => e.sourceType === "task" && e.targetType === "task" && (e.edgeType === "blocks" || e.edgeType === "relates_to"),
    );
    const incomingDeps = incoming.filter(
      (e) => e.sourceType === "task" && e.targetType === "task" && (e.edgeType === "blocks" || e.edgeType === "relates_to"),
    );

    // Enrich helper
    const enrichTask = async (id: string) => {
      const t = await ctx.db.get(id as Id<"tasks">);
      if (!t) return null;
      const project = await ctx.db.get(t.projectId);
      return {
        _id: t._id,
        title: t.title,
        number: t.number,
        projectKey: project?.key,
        completed: t.completed,
      };
    };

    const blocks: Array<{ edgeId: Id<"edges">; task: NonNullable<Awaited<ReturnType<typeof enrichTask>>> }> = [];
    const blockedBy: typeof blocks = [];
    const relatesTo: typeof blocks = [];

    for (const edge of outgoingDeps) {
      const enriched = await enrichTask(edge.targetId);
      if (!enriched) continue;
      const item = { edgeId: edge._id, task: enriched };
      if (edge.edgeType === "blocks") {
        blocks.push(item);
      } else {
        relatesTo.push(item);
      }
    }

    for (const edge of incomingDeps) {
      const enriched = await enrichTask(edge.sourceId);
      if (!enriched) continue;
      const item = { edgeId: edge._id, task: enriched };
      if (edge.edgeType === "blocks") {
        blockedBy.push(item);
      } else {
        // Only add relates_to from incoming if not already added from outgoing
        const alreadyAdded = relatesTo.some((r) => r.task._id === (edge.sourceId as Id<"tasks">));
        if (!alreadyAdded) {
          relatesTo.push(item);
        }
      }
    }

    return { blocks, blockedBy, relatesTo };
  },
});

// ── Graph queries ───────────────────────────────────────────────────

import {
  documentsByWorkspace,
  diagramsByWorkspace,
  spreadsheetsByWorkspace,
  projectsByWorkspace,
  channelsByWorkspace,
  tasksByWorkspace,
} from "./workspaceAggregates";

const graphNodeValidator = v.object({
  id: v.string(),
  type: v.string(),
  name: v.optional(v.string()),
  groupId: v.optional(v.string()),
});

const graphLinkValidator = v.object({
  source: v.string(),
  target: v.string(),
  edgeType: v.string(),
});

const graphCountsValidator = v.object({
  document: v.number(),
  diagram: v.number(),
  spreadsheet: v.number(),
  project: v.number(),
  channel: v.number(),
  task: v.number(),
});

/**
 * Get the workspace knowledge graph: all nodes + edges.
 * Nodes are fetched from the nodes table (includes isolated nodes with no edges).
 * Names are included eagerly — getNodeLabel is only needed for user/message types.
 * Counts are fetched separately via getWorkspaceCounts to avoid coupling
 * graph reactivity to every resource creation/deletion in the workspace.
 */
export const getWorkspaceGraph = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    nodes: v.array(graphNodeValidator),
    links: v.array(graphLinkValidator),
  }),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { nodes: [], links: [] };

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return { nodes: [], links: [] };

    const [nodeRows, edgeRows] = await Promise.all([
      ctx.db.query("nodes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
      ctx.db.query("edges").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
    ]);

    // Build task groupIds from belongs_to edges (task → project containment)
    const nodeGroupIds = new Map<string, string>();
    for (const edge of edgeRows) {
      if ((edge.edgeType as string) === "belongs_to") {
        nodeGroupIds.set(edge.sourceId, edge.targetId);
      }
    }

    const nodes: Array<{ id: string; type: string; name?: string; groupId?: string }> = nodeRows.map((n) => ({
      id: n.resourceId,
      type: n.resourceType,
      name: n.name,
      groupId: nodeGroupIds.get(n.resourceId),
    }));

    // Collect user nodes referenced in edges (not in nodes table)
    const userNodeIds = new Set<string>();
    for (const edge of edgeRows) {
      if (edge.targetType === "user") userNodeIds.add(edge.targetId);
    }
    for (const id of userNodeIds) {
      nodes.push({ id, type: "user" });
    }

    const validNodeIds = new Set(nodes.map((n) => n.id));

    // belongs_to edges are structural (task→project grouping), not semantic links to display.
    // Deduplicate by (sourceId, targetId) since multiple messages in the same channel can
    // each insert their own edge row for the same channel→target pair.
    const seenLinks = new Set<string>();
    const links: Array<{ source: string; target: string; edgeType: string }> = [];
    for (const e of edgeRows) {
      if ((e.edgeType as string) === "belongs_to") continue;
      if (!validNodeIds.has(e.sourceId) || !validNodeIds.has(e.targetId)) continue;
      const key = `${e.sourceId}:${e.targetId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: e.sourceId, target: e.targetId, edgeType: e.edgeType as string });
    }

    return { nodes, links };
  },
});

/**
 * Aggregate resource counts per workspace.
 * Separated from getWorkspaceGraph so that creating/deleting any resource
 * (document, task, etc.) does NOT invalidate the graph structure subscription.
 */
export const getWorkspaceCounts = query({
  args: { workspaceId: v.id("workspaces") },
  returns: graphCountsValidator,
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    const empty = { document: 0, diagram: 0, spreadsheet: 0, project: 0, channel: 0, task: 0 };
    if (!userId) return empty;

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return empty;

    const [docCount, diaCount, ssCount, projCount, chanCount, taskCount] = await Promise.all([
      documentsByWorkspace.count(ctx, { namespace: workspaceId }),
      diagramsByWorkspace.count(ctx, { namespace: workspaceId }),
      spreadsheetsByWorkspace.count(ctx, { namespace: workspaceId }),
      projectsByWorkspace.count(ctx, { namespace: workspaceId }),
      channelsByWorkspace.count(ctx, { namespace: workspaceId }),
      tasksByWorkspace.count(ctx, { namespace: workspaceId }),
    ]);

    return {
      document: docCount,
      diagram: diaCount,
      spreadsheet: ssCount,
      project: projCount,
      channel: chanCount,
      task: taskCount,
    };
  },
});

/**
 * Lazy-load a single node's display label.
 * Called on hover from the graph UI for user and message nodes.
 * Resource nodes (document/diagram/spreadsheet/project/channel/task) resolve
 * via the nodes table using the by_resource index.
 */
export const getNodeLabel = query({
  args: { id: v.string(), type: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { id, type }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const resourceTypes = ["document", "diagram", "spreadsheet", "project", "channel", "task"];
    if (resourceTypes.includes(type)) {
      const node = await ctx.db
        .query("nodes")
        .withIndex("by_resource", (q) => q.eq("resourceId", id))
        .first();
      if (!node) return null;
      return type === "channel" ? `#${node.name}` : node.name;
    }

    if (type === "user") {
      const user = await ctx.db.get(id as Id<"users">);
      return user ? (user.name ?? user.email ?? "User") : null;
    }

    if (type === "message") {
      const message = await ctx.db.get(id as Id<"messages">);
      if (!message) return null;
      const channel = await ctx.db.get(message.channelId);
      return channel ? `#${channel.name}` : null;
    }

    return null;
  },
});
