import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

const resourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
);

type ResourceType = "document" | "diagram" | "spreadsheet" | "project";

async function resolveResource(
  ctx: { db: { get: (id: Id<"documents"> | Id<"diagrams"> | Id<"spreadsheets"> | Id<"projects">) => Promise<{ name: string } | null> } },
  resourceId: string,
): Promise<{ name: string } | null> {
  // Cast is safe — resourceId is always a valid ID from the favorites table
  type AnyResourceId = Id<"documents"> | Id<"diagrams"> | Id<"spreadsheets"> | Id<"projects">;
  const doc = await ctx.db.get(resourceId as AnyResourceId);
  if (!doc) return null;
  return { name: doc.name };
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

export const listPinned = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.any(),
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
  returns: v.any(),
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
      page: enrichedPage.filter(Boolean),
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

    return favorites.map((f) => f.resourceId);
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
