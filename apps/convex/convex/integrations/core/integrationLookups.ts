import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Shared reads for the integration layer. Provider-agnostic — a future
 * provider (or the read-only PR feature, which also attributes external
 * activity to the bot user) reuses these rather than re-deriving the queries.
 *
 * `QueryCtx` is the read floor; `MutationCtx` is assignable to it, so these
 * helpers serve both query and mutation callers.
 */

/**
 * Resolve a workspace's integration row — the single source of truth for the
 * bot user (external-author attribution), provider, and installation id.
 *
 * Returns `null` when the workspace has never installed. Callers decide what
 * that means: a hard error on inbound task/comment creation (we can't
 * attribute authorship without the bot user), or a silent skip on outbound
 * dispatch and the assignee fallback (nothing to push / no fallback owner).
 *
 * One row per workspace today; this lookup is the chokepoint so that
 * invariant has a single place to evolve.
 */
export async function getWorkspaceIntegration(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaceIntegrations"> | null> {
  return ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .unique();
}
