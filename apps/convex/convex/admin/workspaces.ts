import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { query } from "../_generated/server";
import { mutation } from "../functions";
import { auditLog } from "../auditLog";
import { requirePlatformAdmin } from "../authHelpers";
import { cascadeDelete } from "../cascadeDelete";
import {
  channelsByWorkspace,
  diagramsByWorkspace,
  documentsByWorkspace,
  projectsByWorkspace,
  tasksByWorkspace,
} from "../dbTriggers";

/**
 * Admin-only: every workspace with owner identity and member count. Members,
 * channels and projects are each read once and aggregated in memory (no
 * per-workspace N+1). Guard-first, so safe as a public query.
 */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("workspaces"),
      createdAt: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      ownerId: v.id("users"),
      ownerName: v.optional(v.string()),
      ownerEmail: v.optional(v.string()),
      memberCount: v.number(),
      channelCount: v.number(),
      projectCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);

    const [workspaces, members, channels, projects] = await Promise.all([
      ctx.db.query("workspaces").collect(),
      ctx.db.query("workspaceMembers").collect(),
      ctx.db.query("channels").collect(),
      ctx.db.query("projects").collect(),
    ]);

    const tally = <T extends { workspaceId: string }>(rows: T[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.workspaceId, (m.get(r.workspaceId) ?? 0) + 1);
      return m;
    };
    const memberCounts = tally(members);
    const channelCounts = tally(channels);
    const projectCounts = tally(projects);

    return (
      await Promise.all(
        [...workspaces]
          .sort((a, b) => b._creationTime - a._creationTime)
          .map(async (ws) => {
            const owner = await ctx.db.get(ws.ownerId);
            return {
              _id: ws._id,
              createdAt: ws._creationTime,
              name: ws.name,
              description: ws.description,
              ownerId: ws.ownerId,
              ownerName: owner?.name,
              ownerEmail: owner?.email,
              memberCount: memberCounts.get(ws._id) ?? 0,
              channelCount: channelCounts.get(ws._id) ?? 0,
              projectCount: projectCounts.get(ws._id) ?? 0,
            };
          }),
      )
    );
  },
});

/**
 * Admin-only: one workspace with its member list (name + role) and counts.
 *
 * Counts come from the per-workspace aggregates (`dbTriggers.ts`), namespaced by
 * this same `workspaceId` — the same source `workspaces.overview` serves to
 * users, so the console can never disagree with the product. Do NOT go back to
 * `.collect().then(r => r.length)` here: this query is held open as a live
 * subscription by the console's workspace-detail page, so that form re-read the
 * workspace's entire channels/documents/diagrams/projects/tasks ranges on every
 * write anywhere in the workspace. `workspaceIntegrations` has no aggregate and
 * is bounded by the number of connected providers, so it stays a collect.
 */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("workspaces"),
      createdAt: v.number(),
      name: v.string(),
      description: v.optional(v.string()),
      ownerId: v.id("users"),
      counts: v.object({
        channels: v.number(),
        documents: v.number(),
        diagrams: v.number(),
        projects: v.number(),
        tasks: v.number(),
        integrations: v.number(),
      }),
      members: v.array(
        v.object({
          userId: v.id("users"),
          name: v.optional(v.string()),
          email: v.optional(v.string()),
          role: v.string(),
          isOwner: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { workspaceId }) => {
    await requirePlatformAdmin(ctx);

    const ws = await ctx.db.get(workspaceId);
    if (!ws) return null;

    const namespace = workspaceId as string;
    const [memberRows, channels, documents, diagrams, projects, tasks, integrations] =
      await Promise.all([
        // The only range genuinely read for its rows — it backs the member list.
        ctx.db
          .query("workspaceMembers")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect(),
        channelsByWorkspace.count(ctx, { namespace, bounds: {} }),
        documentsByWorkspace.count(ctx, { namespace, bounds: {} }),
        diagramsByWorkspace.count(ctx, { namespace, bounds: {} }),
        projectsByWorkspace.count(ctx, { namespace, bounds: {} }),
        tasksByWorkspace.count(ctx, { namespace, bounds: {} }),
        ctx.db
          .query("workspaceIntegrations")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
          .collect(),
      ]);

    const members = (
      await Promise.all(
        memberRows.map(async (m) => {
          const u = await ctx.db.get(m.userId);
          return {
            userId: m.userId,
            name: u?.name,
            email: u?.email,
            role: m.role,
            isOwner: ws.ownerId === m.userId,
          };
        }),
      )
    ).sort((a, b) => Number(b.isOwner) - Number(a.isOwner));

    return {
      _id: ws._id,
      createdAt: ws._creationTime,
      name: ws.name,
      description: ws.description,
      ownerId: ws.ownerId,
      counts: {
        channels,
        documents,
        diagrams,
        projects,
        tasks,
        integrations: integrations.length,
      },
      members,
    };
  },
});

/**
 * Hard-delete a workspace and everything in it. Uses the batched cascade
 * (the `workspaces` root in cascadeRules) because a workspace can hold a large
 * subtree — channels/messages, projects/tasks, docs, etc. Deletion drains
 * asynchronously via the cascade workpool; the row and its contents disappear
 * as batches complete. Irreversible — the UI gates this behind type-to-confirm.
 */
export const remove = mutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const userId = await requirePlatformAdmin(ctx);

    const ws = await ctx.db.get(workspaceId);
    if (!ws) throw new ConvexError("Workspace not found");

    await auditLog.log(ctx, {
      action: "workspaces.deleted",
      actorId: userId,
      resourceType: "workspaces",
      resourceId: workspaceId,
      severity: "warning",
      scope: workspaceId,
      metadata: { name: ws.name },
    });

    await cascadeDelete.deleteWithCascadeBatched(ctx, "workspaces", workspaceId, {
      batchHandlerRef: internal.cascadeDelete._cascadeBatchHandler,
      onComplete: internal.cascadeDelete._batchCascadeOnComplete,
      onCompleteContext: {
        userId,
        resourceType: "workspaces",
        resourceId: workspaceId,
        scope: workspaceId,
      },
    });

    return null;
  },
});
