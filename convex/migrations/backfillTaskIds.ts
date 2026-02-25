import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * One-time migration: assigns project keys and sequential task numbers
 * to existing projects and tasks that don't have them yet.
 *
 * Run via Convex dashboard: npx convex run migrations/backfillTaskIds:backfill
 */
export const backfill = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();

    for (const project of projects) {
      // Skip if already has a key
      if (project.key) continue;

      // Generate key from name
      const baseKey = project.name
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 3)
        .toUpperCase() || "PRJ";

      let key = baseKey;
      let suffix = 1;
      while (true) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_workspace_key", (q) =>
            q.eq("workspaceId", project.workspaceId).eq("key", key)
          )
          .first();
        if (!existing) break;
        key = `${baseKey}${suffix}`;
        suffix++;
      }

      // Get all tasks for this project, ordered by creation time
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect();

      // Sort by creation time to assign numbers in order
      tasks.sort((a, b) => a._creationTime - b._creationTime);

      // Assign sequential numbers to tasks that don't have them
      let counter = 0;
      for (const task of tasks) {
        if (task.number != null) {
          // Track highest existing number
          counter = Math.max(counter, task.number);
          continue;
        }
        counter++;
        await ctx.db.patch(task._id, { number: counter });
      }

      // Update project with key and counter
      await ctx.db.patch(project._id, { key, taskCounter: counter });
    }

    return null;
  },
});
