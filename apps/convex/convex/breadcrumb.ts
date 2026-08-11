import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { checkChannelAccess, checkWorkspaceMember } from "./authHelpers";

const resourceIdValidator = v.union(v.id("workspaces"), v.id("channels"), v.id("projects"), v.id("documents"), v.id("diagrams"), v.id("spreadsheets"), v.id("tasks"), v.id("cycles"), v.id("calendarEvents"), v.id("taskImportJobs"));

/**
 * Breadcrumb labels are still resource data. This query used to import nothing
 * from `authHelpers` at all — it resolved titles for up to 8192 caller-supplied
 * ids across ten tables, unauthenticated. A document called "Project Bluebird"
 * is exactly the sort of thing a title leak gives away.
 *
 * Both access rules apply here, dispatched by which table the id belongs to:
 * channels take the channel rule (a closed channel's name must not leak to a
 * non-member), everything else takes the workspace rule off the row's own
 * `workspaceId`. A denied id resolves to `null`, which the return validator
 * already permits and the UI already renders as a blank crumb.
 */
async function canSeeResource(
  ctx: QueryCtx,
  resourceId: string,
  // Deliberately loose, as `resolveResourceName` already was: `ctx.db.get` on
  // a ten-table id union widens to every row shape in the data model, and the
  // only field read here is the workspaceId that all of them but `workspaces`
  // and `channels` carry.
  resource: any,
): Promise<boolean> {
  const channelId = ctx.db.normalizeId("channels", resourceId);
  if (channelId) return (await checkChannelAccess(ctx, channelId)) !== null;

  const workspaceId = ctx.db.normalizeId("workspaces", resourceId);
  if (workspaceId) return (await checkWorkspaceMember(ctx, workspaceId)) !== null;

  // Every remaining table in `resourceIdValidator` — projects, documents,
  // diagrams, spreadsheets, tasks, cycles, calendarEvents, taskImportJobs —
  // carries a workspaceId column.
  const owning = ctx.db.normalizeId("workspaces", String(resource.workspaceId ?? ""));
  if (!owning) return false;
  return (await checkWorkspaceMember(ctx, owning)) !== null;
}

async function resolveResourceName(
  ctx: QueryCtx,
  resourceId: string,
): Promise<string | null> {
  const resource: any = await ctx.db.get(resourceId as never);
  if (!resource) return null;
  if (!(await canSeeResource(ctx, resourceId, resource))) return null;

  // For tasks, return the code + title (e.g. "ENG-42 First task").
  // The breadcrumb truncates on overflow, so long titles still render cleanly.
  if ("projectId" in resource && "number" in resource && resource.number != null) {
    const project: any = await ctx.db.get(resource.projectId);
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
