import { ConvexError, v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { requireChannelAccess, requireWorkspaceMember } from "./authHelpers";
import type { BrowsableResourceType } from "@ripple/shared/types/resources";

import { browsableResourceTypeValidator as resourceTypeValidator } from "./validators";

/**
 * The table each browsable type lives in.
 *
 * Deliberately local rather than reusing `authHelpers.WorkspaceResource`:
 * `channels` is not a member of that type and must not become one, because
 * that type carries the *workspace* rule and channels take the *channel* rule
 * (CLAUDE.md). The two are separated below for exactly that reason.
 */
const BROWSABLE_TABLE = {
  channel: "channels",
  document: "documents",
  diagram: "diagrams",
  spreadsheet: "spreadsheets",
  project: "projects",
} as const satisfies Record<BrowsableResourceType, TableNames>;

export const recordVisit = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    resourceType: resourceTypeValidator,
    resourceId: v.string(),
    resourceName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, resourceType, resourceId, resourceName }) => {
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // `resourceId` is a caller-supplied `v.string()`, and `listRecent` below
    // hands it straight to `ctx.db.get`. In production `db.get` THROWS on a
    // malformed id ("Unable to decode ID"), so one bad write — a stale
    // localStorage value, a truncated id, a deliberate call — permanently
    // breaks the caller's own Recent list with no UI able to clear it. Resolve
    // before storing, the way `favorites.toggle` already does.
    const normalized = ctx.db.normalizeId(BROWSABLE_TABLE[resourceType], resourceId);
    if (normalized === null) {
      throw new ConvexError("Resource not found in this workspace");
    }
    if (resourceType === "channel") {
      // The channel rule, not the workspace rule: gating a channel on
      // workspace membership would turn this into an existence oracle for
      // closed channels and DMs the caller cannot see.
      await requireChannelAccess(ctx, normalized as Id<"channels">);
    } else {
      const resource = await ctx.db.get(normalized);
      if (!resource || resource.workspaceId !== workspaceId) {
        throw new ConvexError("Resource not found in this workspace");
      }
    }

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
    const { userId } = await requireWorkspaceMember(ctx, workspaceId);

    // Clamped like the rest of the backend's caller-supplied limits.
    const take = Math.max(1, Math.min(limit, 50));

    const top = await ctx.db
      .query("recentActivity")
      .withIndex("by_user_workspace_visited", (q) => q.eq("userId", userId).eq("workspaceId", workspaceId))
      .order("desc")
      .take(take);

    // Resolve through `normalizeId` rather than casting. `recordVisit` now
    // refuses a malformed id, but rows written before it did still exist, and
    // `ctx.db.get` on a bad string throws in production — which would take out
    // the whole Recent list instead of greying the one dead entry.
    const results = await Promise.all(
      top.map(async (e) => {
        const normalized = ctx.db.normalizeId(BROWSABLE_TABLE[e.resourceType], e.resourceId);
        const doc = normalized === null ? null : await ctx.db.get(normalized);
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
