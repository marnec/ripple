import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

const resourceTypeValidator = v.union(
  v.literal("channel"),
  v.literal("document"),
  v.literal("diagram"),
  v.literal("spreadsheet"),
  v.literal("project"),
);

export const recordVisit = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: resourceTypeValidator,
    resourceId: v.string(),
    resourceName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, resourceType, resourceId, resourceName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    // Check workspace membership
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
      .first();
    if (!membership) throw new ConvexError("Not a member of this workspace");

    // Upsert: check if entry exists for this user + resource
    const existing = await ctx.db
      .query("recentActivity")
      .withIndex("by_user_resource", (q) => q.eq("userId", userId).eq("resourceId", resourceId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { visitedAt: Date.now(), resourceName });
    } else {
      await ctx.db.insert("recentActivity", {
        userId,
        workspaceId,
        resourceType,
        resourceId,
        resourceName,
        visitedAt: Date.now(),
      });
    }

    return null;
  },
});

const recentActivityItemValidator = v.object({
  _id: v.id("recentActivity"),
  _creationTime: v.number(),
  resourceType: resourceTypeValidator,
  resourceId: v.string(),
  resourceName: v.string(),
  visitedAt: v.number(),
  deleted: v.boolean(),
});

export const listRecent = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
  },
  returns: v.array(recentActivityItemValidator),
  handler: async (ctx, { workspaceId, limit = 8 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");

    const entries = await ctx.db
      .query("recentActivity")
      .withIndex("by_user_workspace", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
      .collect();

    // Sort by visitedAt descending and take top N
    entries.sort((a, b) => b.visitedAt - a.visitedAt);
    const top = entries.slice(0, limit);

    // Check existence of each resource (resourceId is stored as string but is a valid Convex ID)
    const results = await Promise.all(
      top.map(async (e) => {
        const doc = await ctx.db.get(e.resourceId as Id<"channels">);
        return {
          _id: e._id,
          _creationTime: e._creationTime,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          resourceName: e.resourceName,
          visitedAt: e.visitedAt,
          deleted: doc === null,
        };
      }),
    );

    return results;
  },
});
