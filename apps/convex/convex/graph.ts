import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { checkChannelAccess, checkChannelAccessBatch, checkWorkspaceMember, visibleChannelIds } from "./authHelpers";

// ── Validators ──────────────────────────────────────────────────────

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

// ── Queries ─────────────────────────────────────────────────────────

/**
 * Get the workspace knowledge graph: all nodes + edges.
 * Nodes are fetched from the nodes table (includes isolated nodes with no edges).
 * User nodes are included via workspace membership (backfilled + trigger-created).
 *
 * Tags don't live in the nodes/edges tables — they're synthesized into the
 * graph at query time so the dashboard's tag toggle / counter work without
 * a schema migration. If tag volume gets heavy we can promote them to the
 * nodes table behind a trigger.
 */
/**
 * Edge kinds the graph actually draws. `belongs_to` is deliberately absent: it
 * is structural (task -> project containment), never rendered as a link, and it
 * is one row per task — the largest single term in this query's read. Its
 * information reaches the client as `groupId` instead, taken from the task
 * node's own `metadata`, and the client re-synthesises the containment line.
 */
const DISPLAYED_EDGE_TYPES = [
  "embeds",
  "blocks",
  "relates_to",
  "mentions",
  "hosted_in",
  "invites",
  "transcript_of",
] as const;

export const getWorkspaceGraph = query({
  args: {
    workspaceId: v.id("workspaces"),
    // Tag nodes are hidden by default in the UI, and building them costs three
    // more whole-table scans (`tags`, `entityTags`, `taskTags`). Only pay for
    // them once the user actually turns the Tags card on.
    includeTags: v.optional(v.boolean()),
  },
  returns: v.object({
    nodes: v.array(graphNodeValidator),
    links: v.array(graphLinkValidator),
  }),
  handler: async (ctx, { workspaceId, includeTags }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return { nodes: [], links: [] };

    const withTags = includeTags ?? false;

    // One indexed range per drawn edge kind rather than one scan of the whole
    // workspace: seven index ranges out of a 4,096 budget, and `belongs_to` is
    // never read at all.
    const [nodeRows, edgeGroups, tagRows, entityTagRows, taskTagRows, channelIds] = await Promise.all([
      ctx.db.query("nodes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
      Promise.all(
        DISPLAYED_EDGE_TYPES.map((edgeType) =>
          ctx.db
            .query("edges")
            .withIndex("by_workspace_edgetype", (q) =>
              q.eq("workspaceId", workspaceId).eq("edgeType", edgeType),
            )
            .collect(),
        ),
      ),
      withTags
        ? ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect()
        : [],
      withTags
        ? ctx.db.query("entityTags").withIndex("by_workspace_tag", (q) => q.eq("workspaceId", workspaceId)).collect()
        : [],
      withTags
        ? ctx.db.query("taskTags").withIndex("by_workspace_tag", (q) => q.eq("workspaceId", workspaceId)).collect()
        : [],
      visibleChannelIds(ctx, workspaceId, auth.userId),
    ]);
    const edgeRows = edgeGroups.flat();

    // The channel rule, not the workspace rule: a closed channel or DM the
    // caller is not in is not a node of their graph. Dropping the node drops
    // its links too (`validNodeIds` below), so neither its name nor what it
    // talks about reaches them.
    const visibleNodeRows = nodeRows.filter(
      (n) => n.resourceType !== "channel" || channelIds.has(n.resourceId),
    );

    const nodes: Array<{ id: string; type: string; name?: string; groupId?: string }> = visibleNodeRows.map((n) => ({
      id: n.resourceId,
      type: n.resourceType,
      name: n.name,
      // Task -> project containment, straight off the node row. Maintained by
      // the tasks node trigger, including across a project move.
      groupId: n.metadata?.type === "task" ? n.metadata.projectId : undefined,
    }));

    // Synthesize tag nodes (one per tag row).
    for (const t of tagRows) {
      nodes.push({ id: t._id, type: "tag", name: t.name });
    }

    const validNodeIds = new Set(nodes.map((n) => n.id));

    // Deduplicate by (sourceId, targetId): a diagram embedded via several frames
    // emits one `embeds` row per frame, and mention edges predating
    // `collapseChannelMentionEdges` may still be a pile of identical rows.
    const seenLinks = new Set<string>();
    const links: Array<{ source: string; target: string; edgeType: string }> = [];
    for (const e of edgeRows) {
      if (!validNodeIds.has(e.sourceId) || !validNodeIds.has(e.targetId)) continue;
      const key = `${e.sourceId}:${e.targetId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: e.sourceId, target: e.targetId, edgeType: e.edgeType });
    }

    // Synthesize tagged_with links from entityTags + taskTags (resource → tag).
    // The client-side hiddenTypes filter hides these whenever "tag" is hidden,
    // so they only render once the user flips the toggle on the Tags card.
    for (const et of entityTagRows) {
      if (!validNodeIds.has(et.resourceId) || !validNodeIds.has(et.tagId)) continue;
      const key = `${et.resourceId}:${et.tagId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: et.resourceId, target: et.tagId, edgeType: "tagged_with" });
    }
    for (const tt of taskTagRows) {
      if (!validNodeIds.has(tt.taskId) || !validNodeIds.has(tt.tagId)) continue;
      const key = `${tt.taskId}:${tt.tagId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: tt.taskId, target: tt.tagId, edgeType: "tagged_with" });
    }

    return { nodes, links };
  },
});

/**
 * Edges read per direction by `getLocalGraph`. A resource's degree is small in
 * practice (channel mentions are one edge per channel, not per message); the
 * cap is what keeps a pathological hub from turning a page header into a
 * whole-table read.
 */
const LOCAL_GRAPH_EDGE_CAP = 200;

/**
 * The **local graph**: one resource and its direct neighbours, depth 1 only.
 *
 * Two index ranges — edges into the resource (`by_workspace_target`) and out
 * of it (`by_source`) — plus one `nodes` point read per neighbour. Unlike
 * `getWorkspaceGraph` its read set is bounded by the resource's degree, so a
 * write elsewhere in the workspace does not re-run it.
 *
 * Channel neighbours follow the channel rule: a closed channel or DM the
 * caller is not in is dropped along with its link, exactly as in
 * `getEnrichedBacklinks`. `belongs_to` is kept (unlike the workspace graph):
 * here the containing project is context, not clutter.
 */
export const getLocalGraph = query({
  args: {
    resourceId: v.string(),
    workspaceId: v.id("workspaces"),
  },
  returns: v.object({
    nodes: v.array(graphNodeValidator),
    links: v.array(graphLinkValidator),
  }),
  handler: async (ctx, { resourceId, workspaceId }) => {
    const empty = { nodes: [], links: [] };
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return empty;

    const center = await ctx.db
      .query("nodes")
      .withIndex("by_resource_workspace", (q) =>
        q.eq("resourceId", resourceId).eq("workspaceId", workspaceId),
      )
      .first();
    if (!center) return empty;

    const [incoming, outgoing] = await Promise.all([
      ctx.db
        .query("edges")
        .withIndex("by_workspace_target", (q) =>
          q.eq("workspaceId", workspaceId).eq("targetId", resourceId),
        )
        .take(LOCAL_GRAPH_EDGE_CAP),
      ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", resourceId))
        .take(LOCAL_GRAPH_EDGE_CAP),
    ]);

    // One link per neighbour; the first edge kind seen labels it. `by_source`
    // has no workspace column, so the workspace check is ours to make.
    const neighbours = new Map<string, { type: string; edgeType: string; outgoing: boolean }>();
    for (const e of incoming) {
      if (e.sourceId === resourceId || neighbours.has(e.sourceId)) continue;
      neighbours.set(e.sourceId, { type: e.sourceType, edgeType: e.edgeType, outgoing: false });
    }
    for (const e of outgoing) {
      if (e.workspaceId !== workspaceId) continue;
      if (e.targetId === resourceId || neighbours.has(e.targetId)) continue;
      neighbours.set(e.targetId, { type: e.targetType, edgeType: e.edgeType, outgoing: true });
    }

    const channelIds = [...neighbours]
      .filter(([, n]) => n.type === "channel")
      .map(([id]) => id as Id<"channels">);
    const channelAccess = channelIds.length
      ? await checkChannelAccessBatch(ctx, channelIds)
      : new Map();

    const visible = [...neighbours].filter(
      ([id, n]) => n.type !== "channel" || channelAccess.has(id as Id<"channels">),
    );
    const nodeRows = await Promise.all(
      visible.map(([id]) =>
        ctx.db
          .query("nodes")
          .withIndex("by_resource_workspace", (q) =>
            q.eq("resourceId", id).eq("workspaceId", workspaceId),
          )
          .first(),
      ),
    );

    const toNode = (n: NonNullable<(typeof nodeRows)[number]>) => ({
      id: n.resourceId,
      type: n.resourceType,
      name: n.resourceType === "channel" ? `#${n.name}` : n.name,
      groupId: n.metadata?.type === "task" ? n.metadata.projectId : undefined,
    });

    const nodes = [toNode(center)];
    const links: Array<{ source: string; target: string; edgeType: string }> = [];
    visible.forEach(([id, n], i) => {
      const row = nodeRows[i];
      // No node row: a deleted resource whose edge has not cascaded yet.
      if (!row) return;
      nodes.push(toNode(row));
      links.push(
        n.outgoing
          ? { source: resourceId, target: id, edgeType: n.edgeType }
          : { source: id, target: resourceId, edgeType: n.edgeType },
      );
    });

    return { nodes, links };
  },
});

/**
 * Lazy-load a single node's display label.
 * Called on hover from the graph UI.
 * All resource types (including users) resolve via the nodes table.
 */
export const getNodeLabel = query({
  args: { id: v.string(), type: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { id, type }) => {
    const node = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", id))
      .first();
    if (!node) return null;

    // The workspace rule, off the node's own workspace — this query takes no
    // workspaceId, so there is nothing else to gate on. `getUser` ("is logged
    // in") let any account resolve any document, task or channel name in any
    // workspace from its id alone.
    const auth = await checkWorkspaceMember(ctx, node.workspaceId);
    if (!auth) return null;

    // A channel's name is the channel's own data: the channel rule, keyed off
    // the node row (not the caller-supplied `type`, which proves nothing).
    if (node.resourceType === "channel") {
      const access = await checkChannelAccess(ctx, node.resourceId as Id<"channels">);
      if (!access) return null;
      return `#${node.name}`;
    }
    return node.name;
  },
});
