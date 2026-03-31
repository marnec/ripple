import { getAuthUserId } from "@convex-dev/auth/server";
import { GenericQueryCtx, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import type { DataModel } from "./_generated/dataModel";

const resourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
);

import type { FavoritableResourceType as ResourceType } from "@shared/types/resources";

async function resolveResource(
  ctx: GenericQueryCtx<DataModel>,
  resourceId: string,
): Promise<{ name: string } | null> {
  const node = await ctx.db
    .query("nodes")
    .withIndex("by_resource", (q) => q.eq("resourceId", resourceId))
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_resource", (q) =>
        q.eq("userId", userId).eq("resourceId", resourceId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
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
    const userId = await getAuthUserId(ctx);
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
      const resource = await resolveResource(ctx, fav.resourceId);
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    const result = await ctx.db
      .query("favorites")
      .withIndex("by_workspace_user_type", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", resourceType),
      )
      .order("desc")
      .paginate(paginationOpts);

    const enrichedPage = await Promise.all(
      result.page.map(async (fav) => {
        const resource = await resolveResource(ctx, fav.resourceId);
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

export const listIdsForType = query({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: resourceTypeValidator,
  },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId, resourceType }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_workspace_user_type", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId).eq("resourceType", resourceType),
      )
      .collect();

    return favorites.map((fav) => fav.resourceId);
  },
});

export const listAllIdsForWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
  },
  returns: v.object({
    document: v.array(v.string()),
    diagram: v.array(v.string()),
    spreadsheet: v.array(v.string()),
    project: v.array(v.string()),
  }),
  handler: async (ctx, { workspaceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { document: [], diagram: [], spreadsheet: [], project: [] };

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", workspaceId).eq("userId", userId),
      )
      .collect();

    const result: Record<ResourceType, string[]> = {
      document: [],
      diagram: [],
      spreadsheet: [],
      project: [],
    };
    for (const fav of favorites) {
      result[fav.resourceType].push(fav.resourceId);
    }
    return result;
  },
});

export const isFavorited = query({
  args: { resourceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { resourceId }) => {
    const userId = await getAuthUserId(ctx);
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
