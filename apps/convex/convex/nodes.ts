import { v } from "convex/values";
import { query } from "./_generated/server";
import { checkWorkspaceMember } from "./authHelpers";

// ── Public queries ────────────────────────────────────────────────────────────

/** Suggestions shown per resource group when the caller doesn't say. */
const SUGGEST_DEFAULT_PER_TYPE = 5;

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

    // `searchable: false` is the calendar-event opt-out; everything
    // else is `true` (enforced by the dbTriggers.ts inserts and the
    // backfillNodeSearchable migration). Filtering at the index level
    // means the search engine never has to materialise the events.
    const results = await ctx.db
      .query("nodes")
      .withSearchIndex("by_name", (q) => {
        const base = q
          .search("name", searchText)
          .eq("workspaceId", workspaceId)
          .eq("searchable", true);
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

/** Resource types the `#` reference picker can offer. */
const suggestTypeValidator = v.union(
  v.literal("project"),
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
);

const suggestionValidator = v.object({
  resourceId: v.string(),
  resourceType: suggestTypeValidator,
  name: v.string(),
});

/**
 * Autocomplete feed for the chat/document `#` reference picker.
 *
 * Point-in-time (called via `convex.query`, not `useQuery`) and bounded: the
 * picker used to client-filter four whole workspace tables shipped down by
 * `workspaceSidebarData.get`. Mirrors `calendarEvents.listForMentionAutocomplete`
 * — FTS while the user types, a short recency browse for the empty query —
 * over the same `nodes.by_name` index Ctrl+K already uses.
 */
export const suggest = query({
  args: {
    workspaceId: v.id("workspaces"),
    types: v.array(suggestTypeValidator),
    query: v.optional(v.string()),
    perType: v.optional(v.number()),
  },
  returns: v.array(suggestionValidator),
  handler: async (ctx, { workspaceId, types, query: searchText, perType }) => {
    const auth = await checkWorkspaceMember(ctx, workspaceId);
    if (!auth) return [];

    const limit = Math.max(1, Math.min(perType ?? SUGGEST_DEFAULT_PER_TYPE, 25));
    const trimmed = (searchText ?? "").trim();

    // One bounded scan per requested type rather than a single wider search:
    // a workspace with 500 documents and 3 diagrams would otherwise let
    // documents crowd every other group out of the result set.
    const perTypeResults = await Promise.all(
      types.map((resourceType) =>
        trimmed.length > 0
          ? ctx.db
              .query("nodes")
              .withSearchIndex("by_name", (q) =>
                q
                  .search("name", trimmed)
                  .eq("workspaceId", workspaceId)
                  .eq("resourceType", resourceType)
                  .eq("searchable", true),
              )
              .take(limit)
          : // Browse mode: an empty search string matches nothing, so the
            // just-opened picker falls back to the newest rows of each type.
            ctx.db
              .query("nodes")
              .withIndex("by_workspace_type", (q) =>
                q.eq("workspaceId", workspaceId).eq("resourceType", resourceType),
              )
              .order("desc")
              .take(limit),
      ),
    );

    return perTypeResults.flat().map((n) => ({
      resourceId: n.resourceId,
      resourceType: n.resourceType as "project" | "document" | "diagram" | "spreadsheet",
      name: n.name,
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
