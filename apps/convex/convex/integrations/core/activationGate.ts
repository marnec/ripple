import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

/**
 * True iff the project meets the preconditions for connecting an integration
 * to it. For v1 the only check is "has an `isTriage=true` status defined" —
 * activation refuses to proceed without a destination for externally-opened
 * issues. The default project seed (since cycle 61) creates one
 * automatically; this gate exists for projects created before that seed
 * landed or projects whose triage status was deleted.
 *
 * Future eligibility checks (workspace entitlement caps, conflicting repo
 * binding, etc.) compose into this same predicate so the wizard surface
 * has a single chokepoint.
 */
export async function canActivateIntegration(
  ctx: QueryCtx,
  args: { projectId: Id<"projects"> },
): Promise<boolean> {
  const triage = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .filter((q) => q.eq(q.field("isTriage"), true))
    .first();
  return triage !== null;
}
