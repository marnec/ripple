import { v } from "convex/values";
import { query } from "./_generated/server";

const resourceIdValidator = v.union(v.id("workspaces"), v.id("channels"), v.id("projects"), v.id("documents"), v.id("diagrams"), v.id("spreadsheets"), v.id("tasks"), v.id("cycles"), v.id("calendarEvents"), v.id("taskImportJobs"));

async function resolveResourceName(
  ctx: { db: { get: (id: any) => Promise<any> } },
  resourceId: string,
): Promise<string | null> {
  const resource = await ctx.db.get(resourceId);
  if (!resource) return null;

  // For tasks, return the code + title (e.g. "ENG-42 First task").
  // The breadcrumb truncates on overflow, so long titles still render cleanly.
  if ("projectId" in resource && "number" in resource && resource.number != null) {
    const project = await ctx.db.get(resource.projectId);
    if (project && project.key) {
      const code = `${project.key}-${resource.number}`;
      const title = "title" in resource ? resource.title : "";
      return title ? `[ ${code} ] ${title}` : `[ ${code} ]`;
    }
  }

  // Task import jobs have no name; render a compact "CSV import (N rows)" label.
  if ("totalRows" in resource && "processedRows" in resource) {
    const n = resource.totalRows as number;
    return `CSV import (${n} row${n === 1 ? "" : "s"})`;
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
