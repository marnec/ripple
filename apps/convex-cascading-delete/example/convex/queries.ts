/*
(1.) Read queries for the example application demo UI
(2.) Wraps component job status, org listings, and document counts
(3.) Enables React hooks to access component and app data
*/

import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";

/** Wrapper query to get deletion job status from the component. */
export const getDeletionJobStatus = query({
  args: { jobId: v.string() },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed")
      ),
      totalTargetCount: v.number(),
      completedCount: v.number(),
      completedSummary: v.string(),
      error: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { jobId }) => {
    return await ctx.runQuery(
      components.convexCascadingDelete.lib.getJobStatus,
      { jobId }
    );
  },
});

/** Retrieves all organizations with nested document counts. */
export const getAllOrganizations = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("organizations"),
      _creationTime: v.number(),
      name: v.string(),
      description: v.string(),
      teamCount: v.number(),
    })
  ),
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();

    const orgsWithCounts = await Promise.all(
      orgs.map(async (org) => {
        const teams = await ctx.db
          .query("teams")
          .withIndex("byOrganizationId", (q) => q.eq("organizationId", org._id))
          .collect();

        return {
          ...org,
          teamCount: teams.length,
        };
      })
    );

    return orgsWithCounts;
  },
});

/** Gets document counts for all tables. */
export const getDocumentCounts = query({
  args: {},
  returns: v.object({
    organizations: v.number(),
    teams: v.number(),
    members: v.number(),
    projects: v.number(),
    tasks: v.number(),
    comments: v.number(),
  }),
  handler: async (ctx) => {
    const [organizations, teams, members, projects, tasks, comments] = await Promise.all([
      ctx.db.query("organizations").collect(),
      ctx.db.query("teams").collect(),
      ctx.db.query("members").collect(),
      ctx.db.query("projects").collect(),
      ctx.db.query("tasks").collect(),
      ctx.db.query("comments").collect(),
    ]);

    return {
      organizations: organizations.length,
      teams: teams.length,
      members: members.length,
      projects: projects.length,
      tasks: tasks.length,
      comments: comments.length,
    };
  },
});
