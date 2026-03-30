import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

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
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];

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

const resourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
  v.literal("channel"),
  v.literal("task"),
  v.literal("user"),
);

/**
 * Suggest nodes for inline menus (e.g. BlockNote #-trigger).
 * When searchText is provided, uses the by_name search index.
 * When empty, returns the first `limit` nodes per type using by_workspace_type.
 */
export const suggest = query({
  args: {
    workspaceId: v.id("workspaces"),
    resourceTypes: v.array(resourceTypeValidator),
    searchText: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(nodeResultValidator),
  handler: async (ctx, { workspaceId, resourceTypes, searchText, limit = 10 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];

    const trimmed = searchText?.trim();

    let results;
    if (trimmed) {
      // Search index query — returns relevance-ranked results across all requested types.
      // Convex search indexes don't support multi-value filter, so we run one query per type.
      const perType = await Promise.all(
        resourceTypes.map((type) =>
          ctx.db
            .query("nodes")
            .withSearchIndex("by_name", (q) =>
              q.search("name", trimmed).eq("workspaceId", workspaceId).eq("resourceType", type),
            )
            .take(limit),
        ),
      );
      results = perType.flat();
    } else {
      // No search text — return first N per type using regular index (bounded).
      const perType = await Promise.all(
        resourceTypes.map((type) =>
          ctx.db
            .query("nodes")
            .withIndex("by_workspace_type", (q) =>
              q.eq("workspaceId", workspaceId).eq("resourceType", type),
            )
            .take(limit),
        ),
      );
      results = perType.flat();
    }

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
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) return [];

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
