import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getAll } from "convex-helpers/server/relationships";
import { logActivity } from "./auditLog";
import {
  channelsByWorkspace,
  diagramsByWorkspace,
  documentsByWorkspace,
  eventsByWorkspace,
  membersByWorkspace,
  projectsByWorkspace,
  spreadsheetsByWorkspace,
  tagsByWorkspace,
  tasksByWorkspace,
} from "./dbTriggers";
import {
  requireUser,
  getUser,
  requireWorkspaceMember,
  checkWorkspaceMember,
} from "./authHelpers";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("workspaces"),
  handler: async (ctx, { name, description }) => {
    const userId = await requireUser(ctx);

    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      description,
      ownerId: userId,
    });

    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: WorkspaceRole.ADMIN,
    });

    await logActivity(ctx, {
      userId, resourceType: "workspaces", resourceId: workspaceId,
      action: "created", newValue: name, resourceName: name, scope: workspaceId,
    });

    return workspaceId;
  },
});

export const list = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("workspaces"),
    _creationTime: v.number(),
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.id("users"),
  })),
  handler: async (ctx) => {
    const userId = await getUser(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const workspaceIds = memberships.map((m) => m.workspaceId);

    // Use getAll helper to batch fetch workspaces
    const workspaces = await getAll(ctx.db, workspaceIds);
    return workspaces.filter((w): w is NonNullable<typeof w> => w !== null);
  },
});

export const get = query({
  args: { id: v.id("workspaces") },
  returns: v.union(
    v.object({
      _id: v.id("workspaces"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      ownerId: v.id("users"),
    }),
    v.null()
  ),
  handler: async (ctx, { id }) => {
    // Was a bare `db.get`: unauthenticated, and it exposes `ownerId`, which
    // chained into the (also ungated) `users.get` for the owner's email.
    const access = await checkWorkspaceMember(ctx, id);
    if (!access) return null;
    return await ctx.db.get(id);
  },
});

/**
 * Counts for the workspace overview cards, served from the nine per-workspace
 * aggregates (`dbTriggers.ts`) as O(log n) B-tree lookups.
 *
 * These aggregates exist for exactly this query. They were registered on the
 * nine tables and backfilled (`migrations:runAll`), but the cards were at some
 * point rewired to count `getWorkspaceGraph`'s nodes instead — which made that
 * unbounded five-table subscription mandatory on the workspace landing page,
 * on mobile and on the Activity tab where the canvas never renders. Counting
 * here is what lets the graph query be gated behind its own tab.
 *
 * Do NOT reintroduce the `.collect().then(r => r.length)` form: it read ~1,000
 * full rows to return six integers the aggregates already hold.
 *
 * Returns null rather than throwing for a non-member, matching `get` and
 * `graph.getWorkspaceGraph`, so an unauthorized URL hit renders ResourceDeleted
 * instead of tripping the error boundary.
 */
export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(
    v.object({
      members: v.number(),
      channels: v.number(),
      tasks: v.number(),
      projects: v.number(),
      documents: v.number(),
      diagrams: v.number(),
      spreadsheets: v.number(),
      calendarEvents: v.number(),
      tags: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { workspaceId }) => {
    // `workspaceId` is caller-chosen, so "is logged in" is not the rule here —
    // these are counts over another tenant's data.
    const access = await checkWorkspaceMember(ctx, workspaceId);
    if (!access) return null;

    const namespace = workspaceId as string;
    const [
      members,
      channels,
      tasks,
      projects,
      documents,
      diagrams,
      spreadsheets,
      calendarEvents,
      tags,
    ] = await Promise.all([
      membersByWorkspace.count(ctx, { namespace, bounds: {} }),
      channelsByWorkspace.count(ctx, { namespace, bounds: {} }),
      tasksByWorkspace.count(ctx, { namespace, bounds: {} }),
      projectsByWorkspace.count(ctx, { namespace, bounds: {} }),
      documentsByWorkspace.count(ctx, { namespace, bounds: {} }),
      diagramsByWorkspace.count(ctx, { namespace, bounds: {} }),
      spreadsheetsByWorkspace.count(ctx, { namespace, bounds: {} }),
      eventsByWorkspace.count(ctx, { namespace, bounds: {} }),
      tagsByWorkspace.count(ctx, { namespace, bounds: {} }),
    ]);

    return {
      members,
      channels,
      tasks,
      projects,
      documents,
      diagrams,
      spreadsheets,
      calendarEvents,
      tags,
    };
  },
});

export const update = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, name, description }) => {
    const { userId } = await requireWorkspaceMember(ctx, id, { role: WorkspaceRole.ADMIN });

    const workspace = await ctx.db.get(id);
    if (!workspace) throw new Error("Workspace not found");

    if (name !== workspace.name) {
      await logActivity(ctx, {
        userId, resourceType: "workspaces", resourceId: id,
        action: "renamed", oldValue: workspace.name, newValue: name, resourceName: name, scope: id,
      });
    }

    await ctx.db.patch(id, {
      name,
      description,
    });
    return null;
  },
});
