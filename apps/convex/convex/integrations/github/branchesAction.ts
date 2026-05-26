import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getWorkspaceIntegration } from "../core/integrationLookups";
import { githubClientFromEnv } from "./client";

/**
 * List the linked repo's branch names for the branch→status settings
 * dropdown. Admin-only (the settings surface is admin-gated). Returns `[]`
 * when credentials are missing or the link/integration can't be resolved —
 * the UI falls back to free-text entry.
 */
export const listRepoBranches = action({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.array(v.string()),
  handler: async (ctx, { linkId }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.github.branchesAction.branchFetchContext,
      { linkId },
    );
    if (!cfg) return [];

    const client = githubClientFromEnv();
    if (!client) return [];

    return client.forInstallation(cfg.externalAccountId).fetchBranches({
      owner: cfg.owner,
      repo: cfg.repo,
    });
  },
});

/**
 * Resolve the owner/repo + installation id for a link, gated on workspace
 * admin. Internal — only the `listRepoBranches` action calls it (auth
 * identity propagates from the action).
 */
export const branchFetchContext = internalQuery({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.union(
    v.null(),
    v.object({
      externalAccountId: v.string(),
      owner: v.string(),
      repo: v.string(),
    }),
  ),
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    const integration = await getWorkspaceIntegration(ctx, link.workspaceId);
    if (!integration) return null;
    const [owner, repo] = link.externalRepoFullName.split("/");
    if (!owner || !repo) return null;
    return { externalAccountId: integration.externalAccountId, owner, repo };
  },
});
