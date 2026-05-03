import { v } from "convex/values";
import { query } from "./_generated/server";
import { checkWorkspaceMember } from "./authHelpers";

// ── Public queries ────────────────────────────────────────────────────────────

const nodeResultValidator = v.object({
  resourceId: v.string(),
  resourceType: v.string(),
  name: v.string(),
  tags: v.array(v.string()),
});

/**
 * Cross-resource search for Ctrl+K. Replaces 5 parallel per-type search queries.
 * Uses the unified nodes.by_name search index.
 */
export const search = query({
  args: {
    workspaceId: v.id("workspaces"),
    searchText: v.string(),
    resourceType: v.optional(
      v.union(
        v.literal("document"),
        v.literal("diagram"),
        v.literal("spreadsheet"),
        v.literal("project"),
        v.literal("channel"),
        v.literal("task"),
      ),
    ),
  },
  returns: v.array(nodeResultValidator),
  handler: async (ctx, { workspaceId, searchText, resourceType }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    const results = await ctx.db
      .query("nodes")
      .withSearchIndex("by_name", (q) => {
        const base = q.search("name", searchText).eq("workspaceId", workspaceId);
        return resourceType ? base.eq("resourceType", resourceType) : base;
      })
      .take(20);

    return results.map((r) => ({
      resourceId: r.resourceId,
      resourceType: r.resourceType,
      name: r.name,
      tags: r.tags,
    }));
  },
});

/**
 * List all nodes in a workspace (used by getWorkspaceGraph).
 */
export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      resourceId: v.string(),
      resourceType: v.string(),
      name: v.string(),
      tags: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { workspaceId }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    return nodes.map((n) => ({
      resourceId: n.resourceId,
      resourceType: n.resourceType,
      name: n.name,
      tags: n.tags,
    }));
  },
});
