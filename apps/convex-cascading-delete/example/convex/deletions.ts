/*
(1.) Delete mutations for the example application
(2.) Provides inline, batched, and targeted cascade deletions
(3.) Includes utility mutation for clearing all data

Contains mutations that delete documents from the database: inline deletion
for small datasets, batched deletion for large hierarchies, sub-tree
deletions for specific tables, and a clear-all mutation for demo resets.
*/

import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { cd } from "./cascading.js";
import { internal } from "./_generated/api.js";

/**
 * Deletes an organization and all related data using inline mode.
 * Suitable for organizations with moderate amounts of data.
 */
export const deleteOrganization = mutation({
  args: { organizationId: v.id("organizations") },
  returns: v.any(),
  handler: async (ctx, { organizationId }) => {
    const summary = await cd.deleteWithCascade(
      ctx,
      "organizations",
      organizationId
    );
    return summary;
  },
});

/**
 * Deletes an organization using batched mode for large datasets.
 * Returns job ID for progress tracking.
 */
export const deleteOrganizationBatched = mutation({
  args: {
    organizationId: v.id("organizations"),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    jobId: v.union(v.string(), v.null()),
    initialSummary: v.any(),
  }),
  handler: async (ctx, { organizationId, batchSize }) => {
    const result = await cd.deleteWithCascadeBatched(
      ctx,
      "organizations",
      organizationId,
      {
        batchHandlerRef: (internal as any).cascading._cascadeBatchHandler,
        batchSize: batchSize || 2000,
      }
    );
    return result;
  },
});

/**
 * Deletes a team and its subtree (members, projects, tasks, comments).
 */
export const deleteTeam = mutation({
  args: { teamId: v.id("teams") },
  returns: v.any(),
  handler: async (ctx, { teamId }) => {
    const summary = await cd.deleteWithCascade(ctx, "teams", teamId);
    return summary;
  },
});

/**
 * Deletes a project and its subtree (tasks, comments).
 */
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  returns: v.any(),
  handler: async (ctx, { projectId }) => {
    const summary = await cd.deleteWithCascade(ctx, "projects", projectId);
    return summary;
  },
});

/**
 * Clears all data from the database.
 */
export const clearAllData = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const tables = ["comments", "tasks", "projects", "members", "teams", "organizations"];

    for (const table of tables) {
      const docs = await ctx.db.query(table as any).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }

    return null;
  },
});
