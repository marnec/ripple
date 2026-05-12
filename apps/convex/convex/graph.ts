import { v } from "convex/values";
import { query } from "./_generated/server";
import { checkWorkspaceMember, getUser } from "./authHelpers";

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
export const getWorkspaceGraph = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    nodes: v.array(graphNodeValidator),
    links: v.array(graphLinkValidator),
  }),
  handler: async (ctx, { workspaceId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return { nodes: [], links: [] };

    const [nodeRows, edgeRows, tagRows, entityTagRows, taskTagRows] = await Promise.all([
      ctx.db.query("nodes").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
      ctx.db.query("edges").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
      ctx.db.query("tags").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect(),
      ctx.db.query("entityTags").withIndex("by_workspace_tag", (q) => q.eq("workspaceId", workspaceId)).collect(),
      ctx.db.query("taskTags").withIndex("by_workspace_tag", (q) => q.eq("workspaceId", workspaceId)).collect(),
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

    // Synthesize tag nodes (one per tag row).
    for (const t of tagRows) {
      nodes.push({ id: t._id, type: "tag", name: t.name });
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
 * Lazy-load a single node's display label.
 * Called on hover from the graph UI.
 * All resource types (including users) resolve via the nodes table.
 */
export const getNodeLabel = query({
  args: { id: v.string(), type: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { id, type }) => {
    const userId = await getUser(ctx);
    if (!userId) return null;

    const node = await ctx.db
      .query("nodes")
      .withIndex("by_resource", (q) => q.eq("resourceId", id))
      .first();
    if (!node) return null;
    return type === "channel" ? `#${node.name}` : node.name;
  },
});
