import { v } from "convex/values";
import { query } from "./_generated/server";

const resourceIdValidator = v.union(v.id("workspaces"), v.id("channels"), v.id("projects"), v.id("documents"), v.id("diagrams"), v.id("spreadsheets"), v.id("tasks"), v.id("cycles"));

async function resolveResourceName(
  ctx: { db: { get: (id: any) => Promise<any> } },
  resourceId: string,
): Promise<string | null> {
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
}

export const getResourceNames = query({
  args: {
    resourceIds: v.array(resourceIdValidator),
  },
  returns: v.record(v.string(), v.union(v.string(), v.null())),
  handler: async (ctx, { resourceIds }) => {
    const results: Record<string, string | null> = {};
    await Promise.all(
      resourceIds.map(async (id) => {
        results[id] = await resolveResourceName(ctx, id);
      }),
    );
    return results;
  },
});
