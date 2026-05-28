import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getIntegrationForLink } from "./integrationLookups";

/**
 * Provider-agnostic branch list for the project-settings pickers (branch
 * automation map, default base branch). Resolves the link's provider once and
 * delegates to the per-provider action, which owns the auth + transport. The
 * existing GitHub action stays public for backwards compatibility; new
 * frontends should call this entry instead so the picker works for any
 * provider without UI branches.
 *
 * Returns `[]` for unknown providers — same degrade-to-free-text contract the
 * per-provider actions follow on credential / network failure.
 */
export const listRepoBranches = action({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.array(v.string()),
  handler: async (ctx, { linkId }) => {
    const provider = await ctx.runQuery(
      internal.integrations.core.branchesAction.providerForLink,
      { linkId },
    );
    if (provider === "github") {
      return ctx.runAction(
        api.integrations.github.branchesAction.listRepoBranches,
        { linkId },
      );
    }
    if (provider === "gitlab") {
      return ctx.runAction(
        api.integrations.gitlab.branchesAction.listRepoBranches,
        { linkId },
      );
    }
    return [];
  },
});

export const providerForLink = internalQuery({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    const integration = await getIntegrationForLink(ctx, link);
    return integration?.provider ?? null;
  },
});
