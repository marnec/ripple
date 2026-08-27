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
    .first();
}

/**
 * Resolve a workspace's integration row for one specific provider.
 *
 * The provider-scoped sibling of `getWorkspaceIntegration`. A workspace can
 * hold both a GitHub and a GitLab install, so callers that already know which
 * provider they mean must say so: `getWorkspaceIntegration` returns whichever
 * row sorts first, which would mis-attribute a GitLab failure to the GitHub
 * install (or vice versa).
 *
 * Reads `by_workspace_provider` rather than narrowing `by_workspace` with a
 * `.filter()` — the row count per workspace is small either way, but the index
 * makes the intent explicit and is what `@convex-dev/no-filter-in-query` asks
 * for.
 */
export async function getWorkspaceIntegrationByProvider(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  provider: string,
): Promise<Doc<"workspaceIntegrations"> | null> {
  return ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace_provider", (q) =>
      q.eq("workspaceId", workspaceId).eq("provider", provider),
    )
    .first();
}

/**
 * Resolve the integration a project link belongs to. This is the correct
 * resolver for any caller that has a `projectIntegrationLinks` row, because a
 * workspace may hold several integrations (multi-account / multi-provider) and
 * `getWorkspaceIntegration` only returns *one* of them. Reads the link's
 * `workspaceIntegrationId` FK; falls back to the workspace lookup only for
 * legacy links written before the FK existed (single-install era, so the
 * fallback is unambiguous there).
 */
export async function getIntegrationForLink(
  ctx: QueryCtx,
  link: Doc<"projectIntegrationLinks">,
): Promise<Doc<"workspaceIntegrations"> | null> {
  if (link.workspaceIntegrationId) {
    return ctx.db.get(link.workspaceIntegrationId);
  }
  return getWorkspaceIntegration(ctx, link.workspaceId);
}

/**
 * The provider for a (possibly null) integration row, applying the legacy
 * default. Links and rows written in the single-install, GitHub-only era predate
 * the `provider` field; a missing integration or provider therefore resolves to
 * `"github"`. This is the single home for that rule — callers previously
 * copy-pasted `integration?.provider ?? "github"` (with the same comment) at
 * ~8 sites, which meant the legacy invariant had eight places to drift.
 */
export function resolveProvider(
  integration: Doc<"workspaceIntegrations"> | null,
): string {
  return integration?.provider ?? "github";
}
