/*
(1.) Recursive query that returns an organization with all nested documents
(2.) Output includes teams, members, projects, tasks, and comments
(3.) Used to inspect hierarchy before/after cascade deletions

Returns a single organization's full document tree. Each level (teams,
members, projects, tasks, comments) is nested inside its parent object.
Used to verify that cascade deletions removed all expected documents.
*/

import { v } from "convex/values";
import { query } from "./_generated/server.js";

/**
 * Retrieves complete organizational tree with all nested entities.
 */
export const getOrganizationTree = query({
  args: { organizationId: v.id("organizations") },
  returns: v.any(),
  handler: async (ctx, { organizationId }) => {
    const org = await ctx.db.get(organizationId);
    if (!org) return null;

    const teams = await ctx.db
      .query("teams")
      .withIndex("byOrganizationId", (q) => q.eq("organizationId", organizationId))
      .collect();

    const teamsWithData = await Promise.all(
      teams.map(async (team) => {
        const members = await ctx.db
          .query("members")
          .withIndex("byTeamId", (q) => q.eq("teamId", team._id))
          .collect();

        const projects = await ctx.db
          .query("projects")
          .withIndex("byTeamId", (q) => q.eq("teamId", team._id))
          .collect();

        const projectsWithTasks = await Promise.all(
          projects.map(async (project) => {
            const tasks = await ctx.db
              .query("tasks")
              .withIndex("byProjectId", (q) => q.eq("projectId", project._id))
              .collect();

            const tasksWithComments = await Promise.all(
              tasks.map(async (task) => {
                const comments = await ctx.db
                  .query("comments")
                  .withIndex("byTaskId", (q) => q.eq("taskId", task._id))
                  .collect();

                return { ...task, comments };
              })
            );

            return { ...project, tasks: tasksWithComments };
          })
        );

        return { ...team, members, projects: projectsWithTasks };
      })
    );

    return { ...org, teams: teamsWithData };
  },
});
