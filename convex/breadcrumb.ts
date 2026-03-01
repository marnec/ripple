import { v } from "convex/values";
import { query } from "./_generated/server";

export const getResourceName = query({
  args: {
    resourceId: v.union(v.id("workspaces"), v.id("channels"), v.id("projects"), v.id("documents"), v.id("diagrams"), v.id("spreadsheets"), v.id("tasks")),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { resourceId }) => {
    const resource = await ctx.db.get(resourceId);
    if (!resource) return null;

    // For tasks, return the project key + task number (e.g. "ENG-42")
    if ("projectId" in resource && "number" in resource && resource.number != null) {
      const project = await ctx.db.get(resource.projectId);
      if (project && project.key) {
        return `${project.key}-${resource.number}`;
      }
    }

    return "title" in resource ? resource.title : resource.name;
  },
});
