import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { logTaskActivity } from "./auditLog";
import {
  extractMentionedUserIds,
  extractTaskMentionIds,
  extractProjectIds,
  extractResourceReferenceIds,
} from "./utils/blocknote";

// ── Validators ──────────────────────────────────────────────────────

const backlinkValidator = v.object({
  _id: v.id("edges"),
  sourceType: v.string(),
  sourceId: v.string(),
  sourceName: v.string(),
  edgeType: v.string(),
  workspaceId: v.string(),
  projectId: v.optional(v.string()),
  groupId: v.optional(v.string()),
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
  groupId?: string;
}>> {
  const edges = await ctx.db
    .query("edges")
    .withIndex("by_target", (q) => q.eq("targetId", targetId))
    .collect();

  return Promise.all(
    edges.map(async (edge) => {
      let sourceName = "Unknown";
      let projectId: string | undefined;
      if (edge.sourceType === "document") {
        const doc = await ctx.db.get(edge.sourceId as Id<"documents">);
        sourceName = doc?.name ?? "Deleted document";
      } else if (edge.sourceType === "task") {
        const task = await ctx.db.get(edge.sourceId as Id<"tasks">);
        sourceName = task?.title ?? "Deleted task";
        projectId = task?.projectId;
      } else if (edge.sourceType === "diagram") {
        const diagram = await ctx.db.get(edge.sourceId as Id<"diagrams">);
        sourceName = diagram?.name ?? "Deleted diagram";
      } else if (edge.sourceType === "spreadsheet") {
        const spreadsheet = await ctx.db.get(edge.sourceId as Id<"spreadsheets">);
        sourceName = spreadsheet?.name ?? "Deleted spreadsheet";
      } else if (edge.sourceType === "message") {
        const message = await ctx.db.get(edge.sourceId as Id<"messages">);
        if (message) {
          const channel = await ctx.db.get(message.channelId);
          sourceName = channel?.name ? `#${channel.name}` : "Deleted channel";
        } else {
          sourceName = "Deleted message";
        }
      }
      return {
        _id: edge._id,
        sourceType: edge.sourceType as string,
        sourceId: edge.sourceId,
        sourceName,
        edgeType: edge.edgeType as string,
        workspaceId: edge.workspaceId as string,
        projectId,
        groupId: edge.groupId,
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

// ── Message edges ───────────────────────────────────────────────────

/**
 * Extract all reference targets from a message body.
 * Pure function — no DB access.
 */
export function extractMessageTargets(body: string): Array<{ targetType: "user" | "task" | "project" | "document" | "diagram" | "spreadsheet"; targetId: string }> {
  const targets: Array<{ targetType: "user" | "task" | "project" | "document" | "diagram" | "spreadsheet"; targetId: string }> = [];
  const seen = new Set<string>();

  const add = (targetType: typeof targets[number]["targetType"], targetId: string) => {
    if (!seen.has(targetId)) {
      seen.add(targetId);
      targets.push({ targetType, targetId });
    }
  };

  for (const userId of extractMentionedUserIds(body)) add("user", userId);
  for (const taskId of extractTaskMentionIds(body)) add("task", taskId);
  for (const projectId of extractProjectIds(body)) add("project", projectId);
  for (const ref of extractResourceReferenceIds(body)) {
    add(ref.type as "document" | "diagram" | "spreadsheet", ref.id);
  }

  return targets;
}

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

// ── Graph query ─────────────────────────────────────────────────────

const graphNodeValidator = v.object({
  id: v.string(),
  type: v.string(),
  name: v.string(),
  groupId: v.optional(v.string()),
});

const graphLinkValidator = v.object({
  source: v.string(),
  target: v.string(),
  edgeType: v.string(),
});

/**
 * Get the full workspace knowledge graph: all nodes and edges.
 * Powers the force-directed graph visualization.
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

    // Fetch all edges in this workspace
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_workspace_target", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    // Collect unique node IDs from edges
    const nodeIds = new Map<string, string>(); // id → type
    for (const edge of edges) {
      nodeIds.set(edge.sourceId, edge.sourceType);
      nodeIds.set(edge.targetId, edge.targetType);
    }

    // Batch-resolve node names and groupIds
    const nodes: Array<{ id: string; type: string; name: string; groupId?: string }> = [];
    for (const [id, type] of nodeIds) {
      let name = "Unknown";
      let groupId: string | undefined;
      if (type === "document") {
        const doc = await ctx.db.get(id as Id<"documents">);
        if (!doc) continue;
        name = doc.name;
      } else if (type === "task") {
        const task = await ctx.db.get(id as Id<"tasks">);
        if (!task) continue;
        name = task.title;
        groupId = task.projectId;
      } else if (type === "diagram") {
        const diagram = await ctx.db.get(id as Id<"diagrams">);
        if (!diagram) continue;
        name = diagram.name;
      } else if (type === "spreadsheet") {
        const spreadsheet = await ctx.db.get(id as Id<"spreadsheets">);
        if (!spreadsheet) continue;
        name = spreadsheet.name;
      } else if (type === "user") {
        const user = await ctx.db.get(id as Id<"users">);
        if (!user) continue;
        name = user.name ?? user.email ?? "User";
      } else if (type === "project") {
        const project = await ctx.db.get(id as Id<"projects">);
        if (!project) continue;
        name = project.name;
      } else if (type === "channel") {
        const channel = await ctx.db.get(id as Id<"channels">);
        if (!channel) continue;
        name = `#${channel.name}`;
      } else if (type === "message") {
        const message = await ctx.db.get(id as Id<"messages">);
        if (!message) continue;
        const channel = await ctx.db.get(message.channelId);
        name = channel?.name ? `#${channel.name}` : "message";
        groupId = message.channelId;
      } else {
        continue;
      }
      nodes.push({ id, type, name, groupId });
    }

    // Only include edges where both source and target resolved
    const validNodeIds = new Set(nodes.map((n) => n.id));
    const links = edges
      .filter((e) => validNodeIds.has(e.sourceId) && validNodeIds.has(e.targetId))
      .map((e) => ({
        source: e.sourceId,
        target: e.targetId,
        edgeType: e.edgeType as string,
      }));

    return { nodes, links };
  },
});
