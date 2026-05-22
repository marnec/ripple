import { v } from "convex/values";
import { query, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireWorkspaceMember } from "../../authHelpers";

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
    .withIndex("by_project_isTriage", (q) =>
      q.eq("projectId", args.projectId).eq("isTriage", true),
    )
    .first();
  return triage !== null;
}

/**
 * Public read powering the GitHub card's pre-flight gate. Resolves the
 * project's workspace, member-gates the read, and reports whether the project
 * is eligible to connect a repo. When false, the card blocks the wizard from
 * opening and points the user at the Status Effect Matrix to assign a triage
 * (issue-inbox) status first.
 */
export const canActivate = query({
  args: { projectId: v.id("projects") },
  returns: v.object({ canActivate: v.boolean() }),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return { canActivate: false };
    await requireWorkspaceMember(ctx, project.workspaceId);
    return {
      canActivate: await canActivateIntegration(ctx, {
        projectId: args.projectId,
      }),
    };
  },
});
