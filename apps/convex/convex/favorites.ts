import { GenericQueryCtx, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";
import { requireWorkspaceMember, getUser, type WorkspaceResource } from "./authHelpers";

import { favoritableResourceTypeValidator as resourceTypeValidator } from "./validators";

import type { FavoritableResourceType as ResourceType } from "@ripple/shared/types/resources";

/**
 * The table each favoritable type actually lives in. `satisfies` makes adding a
 * favoritable type that isn't workspace-scoped a compile error, so `toggle`'s
 * `workspaceId` comparison below can never be reading a field that isn't there.
 */
const FAVORITABLE_TABLE = {
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  project: "projects",
} as const satisfies Record<ResourceType, WorkspaceResource>;

/**
 * Resolve a favorite's display name, scoped to the workspace it was pinned in.
 *
 * The workspace predicate is not belt-and-braces for `toggle`'s check — it is
 * the half that closes rows already stored. `favorites.resourceId` is a
 * `v.string()` that used to be written unvalidated, and this resolved it
 * through the workspace-blind `by_resource` index, so a pinned foreign id
 * rendered that workspace's document title in the sidebar and re-rendered it on
 * every rename. Same hardening `graph.getNodeLabel` already carries.
 */
async function resolveResource(
  ctx: GenericQueryCtx<DataModel>,
  workspaceId: Id<"workspaces">,
  resourceId: string,
): Promise<{ name: string } | null> {
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource_workspace", (q) =>
      q.eq("resourceId", resourceId).eq("workspaceId", workspaceId),
    )
    .first();
  if (!node) return null;
  return { name: node.name };
}

export const toggle = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: resourceTypeValidator,
    resourceId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, resourceType, resourceId }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_resource", (q) =>
        q.eq("userId", userId).eq("resourceId", resourceId),
      )
      .first();

    // Un-pinning is deliberately not gated on the checks below: a row written
    // before them (or pointing at a since-deleted resource) must still be
    // removable by the person who owns it.
    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
    }

    // The gate above authorized `workspaceId`, not `resourceId` — which is a
    // caller-supplied `v.string()`. Resolve it against its own table rather
    // than the `nodes` index: that refuses a malformed or deleted id too, and
    // does not depend on `nodes` having been backfilled in this deployment.
    const normalized = ctx.db.normalizeId(FAVORITABLE_TABLE[resourceType], resourceId);
    const resource = normalized === null ? null : await ctx.db.get(normalized);
    if (!resource || resource.workspaceId !== workspaceId) {
      throw new ConvexError("Resource not found in this workspace");
    }

    await ctx.db.insert("favorites", {
      userId,
      workspaceId,
      resourceType,
      resourceId,
      favoritedAt: Date.now(),
    });
    return true;
  },
});

const enrichedFavoriteValidator = v.object({
  _id: v.id("favorites"),
  resourceType: resourceTypeValidator,
  resourceId: v.string(),
  name: v.string(),
  favoritedAt: v.number(),
});

export const listPinned = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(enrichedFavoriteValidator),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getUser(ctx);
    if (!userId) return [];

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .order("desc")
      .take(10); // fetch extra to account for deleted resources

    const enriched: Array<{
      _id: Id<"favorites">;
      resourceType: ResourceType;
      resourceId: string;
      name: string;
      favoritedAt: number;
    }> = [];

    for (const fav of favorites) {
      if (enriched.length >= 5) break;
      const resource = await resolveResource(ctx, workspaceId, fav.resourceId);
      if (resource) {
        enriched.push({
          _id: fav._id,
          resourceType: fav.resourceType,
          resourceId: fav.resourceId,
          name: resource.name,
          favoritedAt: fav.favoritedAt,
        });
      }
    }

    return enriched;
  },
});

export const listByType = query({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: resourceTypeValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(enrichedFavoriteValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())),
  }),
  handler: async (ctx, { workspaceId, resourceType, paginationOpts }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    const result = await ctx.db
      .query("favorites")
      .withIndex("by_workspace_user_type", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", resourceType),
      )
      .order("desc")
      .paginate(paginationOpts);

    const enrichedPage = await Promise.all(
      result.page.map(async (fav) => {
        const resource = await resolveResource(ctx, workspaceId, fav.resourceId);
        return resource
          ? {
              _id: fav._id,
              resourceType: fav.resourceType,
              resourceId: fav.resourceId,
              name: resource.name,
              favoritedAt: fav.favoritedAt,
            }
          : null;
      }),
    );

    return {
      ...result,
      page: enrichedPage.filter(
        (item): item is NonNullable<typeof item> => item !== null,
      ),
    };
  },
});

// `listIdsForType` and `listAllIdsForWorkspace` were removed: neither had a
// caller anywhere in the monorepo. What the UI actually uses is `isFavorited`
// (per-resource) and `listPinned` / the `isFavorite` filter on each
// resource's own search query, which return the rows already joined to their
// names rather than bare id lists a caller would have to re-resolve.

export const isFavorited = query({
  args: { resourceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { resourceId }) => {
    const userId = await getUser(ctx);
    if (!userId) return false;

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_resource", (q) =>
        q.eq("userId", userId).eq("resourceId", resourceId),
      )
      .first();

    return !!existing;
  },
});
