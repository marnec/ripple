import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
  workspaceId: Id<"workspaces">,
): Promise<Array<{
  _id: Id<"edges">;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  edgeType: string;
  workspaceId: string;
  projectId?: string;
}>> {
  const allEdges = await ctx.db
    .query("edges")
    .withIndex("by_workspace_target", (q) =>
      q.eq("workspaceId", workspaceId).eq("targetId", targetId),
    )
    .collect();

  // Channel mention edges: one row per message, deduplicate to one entry per (sourceId, edgeType).
  // Other edge types are already unique per (sourceId, targetId) by construction.
  const seenSourceEdge = new Set<string>();
  const edges = allEdges.filter((e) => {
    const key = `${e.sourceId}:${e.edgeType}`;
    if (seenSourceEdge.has(key)) return false;
    seenSourceEdge.add(key);
    return true;
  });

  // Collect typed IDs for batch fetching
  const taskIds = edges
    .filter((e) => e.sourceType === "task")
    .map((e) => e.sourceId as Id<"tasks">);
  const channelIds = edges
    .filter((e) => e.sourceType === "channel")
    .map((e) => e.sourceId as Id<"channels">);

  // Batch-fetch in three parallel waves
  const [nodeResults, taskResults, channelResults] = await Promise.all([
    Promise.all(
      edges.map((e) =>
        ctx.db
          .query("nodes")
          .withIndex("by_resource", (q) => q.eq("resourceId", e.sourceId))
          .first(),
      ),
    ),
    Promise.all(taskIds.map((id) => ctx.db.get(id))),
    Promise.all(channelIds.map((id) => ctx.db.get(id))),
  ]);

  const taskById = new Map(taskIds.map((id, i) => [id as string, taskResults[i]]));
  const channelById = new Map(channelIds.map((id, i) => [id as string, channelResults[i]]));

  // Single-pass enrich
  return edges.map((edge, i) => {
    const node = nodeResults[i];
    let sourceName = node?.name;
    if (!sourceName && edge.sourceType === "channel") {
      const channel = channelById.get(edge.sourceId);
      sourceName = channel?.name ? `#${channel.name}` : undefined;
    }
    sourceName ??= `Deleted ${edge.sourceType}`;

    const projectId =
      edge.sourceType === "task"
        ? taskById.get(edge.sourceId)?.projectId
        : undefined;

    return {
      _id: edge._id,
      sourceType: edge.sourceType as string,
      sourceId: edge.sourceId,
      sourceName,
      edgeType: edge.edgeType as string,
      workspaceId: edge.workspaceId as string,
      projectId,
    };
  });
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

    const existingEmbeds = await ctx.db
      .query("edges")
      .withIndex("by_source_edgetype", (q) =>
        q.eq("sourceId", sourceId).eq("edgeType", "embeds"),
      )
      .collect();

    const existingByTarget = new Map(existingEmbeds.map((r) => [r.targetId, r]));
    const newTargetIds = new Set(references.map((r) => r.targetId));

    await Promise.all([
      ...existingEmbeds
        .filter((e) => !newTargetIds.has(e.targetId))
        .map((e) => ctx.db.delete(e._id)),
      ...references
        .filter((ref) => !existingByTarget.has(ref.targetId))
        .map((ref) =>
          ctx.db.insert("edges", {
            sourceType,
            sourceId,
            targetType: ref.targetType,
            targetId: ref.targetId,
            edgeType: "embeds",
            workspaceId,
            createdBy: userId,
            createdAt: Date.now(),
          }),
        ),
    ]);

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

    const existingMentions = await ctx.db
      .query("edges")
      .withIndex("by_source_edgetype", (q) =>
        q.eq("sourceId", sourceId).eq("edgeType", "mentions"),
      )
      .collect();

    const existingByTarget = new Map(existingMentions.map((e) => [e.targetId, e]));
    const newTargetIds = new Set(mentionedUserIds);

    await Promise.all([
      ...existingMentions
        .filter((e) => !newTargetIds.has(e.targetId))
        .map((e) => ctx.db.delete(e._id)),
      ...mentionedUserIds
        .filter((id) => !existingByTarget.has(id))
        .map((id) =>
          ctx.db.insert("edges", {
            sourceType,
            sourceId,
            targetType: "user",
            targetId: id,
            edgeType: "mentions",
            workspaceId,
            createdBy: userId,
            createdAt: Date.now(),
          }),
        ),
    ]);

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


// ── Queries ─────────────────────────────────────────────────────────

/**
 * Get all backlinks pointing to a target resource, enriched with source names.
 * Powers the Backlinks component and DeleteWarningDialog.
 */
export const getBacklinks = query({
  args: {
    targetId: v.string(),
    workspaceId: v.id("workspaces"),
  },
  returns: v.array(backlinkValidator),
  handler: async (ctx, { targetId, workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return getEnrichedBacklinks(ctx, targetId, workspaceId);
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

    // Fetch only the relevant edge types in parallel; blocks/relates_to are exclusively task→task
    const [outBlocks, outRelates, inBlocks, inRelates] = await Promise.all([
      ctx.db.query("edges").withIndex("by_source_edgetype", (q) => q.eq("sourceId", taskId).eq("edgeType", "blocks")).collect(),
      ctx.db.query("edges").withIndex("by_source_edgetype", (q) => q.eq("sourceId", taskId).eq("edgeType", "relates_to")).collect(),
      ctx.db.query("edges").withIndex("by_target_edgetype", (q) => q.eq("targetId", taskId).eq("edgeType", "blocks")).collect(),
      ctx.db.query("edges").withIndex("by_target_edgetype", (q) => q.eq("targetId", taskId).eq("edgeType", "relates_to")).collect(),
    ]);

    const outgoingDeps = [...outBlocks, ...outRelates];
    const incomingDeps = [...inBlocks, ...inRelates];

    // Collect all referenced task IDs (deduplicated)
    const referencedTaskIds = [
      ...new Set([
        ...outgoingDeps.map((e) => e.targetId as Id<"tasks">),
        ...incomingDeps.map((e) => e.sourceId as Id<"tasks">),
      ]),
    ];

    // Batch-fetch tasks, then batch-fetch their projects in parallel
    const tasks = await Promise.all(referencedTaskIds.map((id) => ctx.db.get(id)));
    const taskById = new Map(
      referencedTaskIds.map((id, i) => [id as string, tasks[i]]),
    );

    const projectIds = [...new Set(tasks.flatMap((t) => (t ? [t.projectId] : [])))];
    const projects = await Promise.all(projectIds.map((id) => ctx.db.get(id)));
    const projectById = new Map(projectIds.map((id, i) => [id as string, projects[i]]));

    const enrichTask = (id: string) => {
      const t = taskById.get(id);
      if (!t) return null;
      return {
        _id: t._id,
        title: t.title,
        number: t.number,
        projectKey: projectById.get(t.projectId as string)?.key,
        completed: t.completed,
      };
    };

    type DepItem = { edgeId: Id<"edges">; task: NonNullable<ReturnType<typeof enrichTask>> };
    const blocks: DepItem[] = [];
    const blockedBy: DepItem[] = [];
    const relatesTo: DepItem[] = [];
    const relatesToSeen = new Set<string>();

    for (const edge of outgoingDeps) {
      const enriched = enrichTask(edge.targetId);
      if (!enriched) continue;
      if (edge.edgeType === "blocks") {
        blocks.push({ edgeId: edge._id, task: enriched });
      } else {
        relatesToSeen.add(edge.targetId);
        relatesTo.push({ edgeId: edge._id, task: enriched });
      }
    }

    for (const edge of incomingDeps) {
      const enriched = enrichTask(edge.sourceId);
      if (!enriched) continue;
      if (edge.edgeType === "blocks") {
        blockedBy.push({ edgeId: edge._id, task: enriched });
      } else if (!relatesToSeen.has(edge.sourceId)) {
        relatesTo.push({ edgeId: edge._id, task: enriched });
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
      if (edge.edgeType === "belongs_to") {
        nodeGroupIds.set(edge.sourceId, edge.targetId);
      }
    }

    const nodes: Array<{ id: string; type: string; name?: string; groupId?: string }> = nodeRows.map((n) => ({
      id: n.resourceId,
      type: n.resourceType,
      name: n.name,
      groupId: nodeGroupIds.get(n.resourceId),
    }));

    // Collect user nodes referenced in edges (not in nodes table); batch-fetch names
    const userNodeIds = [...new Set(
      edgeRows.filter((e) => e.targetType === "user").map((e) => e.targetId),
    )];
    const users = await Promise.all(
      userNodeIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    for (let i = 0; i < userNodeIds.length; i++) {
      const u = users[i];
      nodes.push({ id: userNodeIds[i], type: "user", name: u?.name ?? u?.email ?? undefined });
    }

    const validNodeIds = new Set(nodes.map((n) => n.id));

    // belongs_to edges are structural (task→project grouping), not semantic links to display.
    // Deduplicate by (sourceId, targetId) since multiple messages in the same channel can
    // each insert their own edge row for the same channel→target pair.
    const seenLinks = new Set<string>();
    const links: Array<{ source: string; target: string; edgeType: string }> = [];
    for (const e of edgeRows) {
      if (e.edgeType === "belongs_to") continue;
      if (!validNodeIds.has(e.sourceId) || !validNodeIds.has(e.targetId)) continue;
      const key = `${e.sourceId}:${e.targetId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: e.sourceId, target: e.targetId, edgeType: e.edgeType });
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
 * Called on hover from the graph UI for user nodes.
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

    return null;
  },
});
