import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getIntegrationForLink } from "../core/integrationLookups";
import {
  GITLAB_BASE,
  type GitlabOAuthConfig,
  fetchBranches,
  gitlabOAuthFromEnv,
} from "./oauthClient";
import { getValidGitlabAccessToken } from "./tokenClient";

/**
 * GitLab side of the provider-agnostic branch list. Mirrors GitHub's
 * `listRepoBranches` (auth-gated by `branchFetchContext`, returns `[]` on any
 * resolution / network failure so the UI degrades to free-text). The
 * link's `externalRepoId` IS the GitLab numeric project id (per schema), so
 * no name-splitting is needed.
 *
 * OAuth env vars are NOT required for PAT installs — `getValidGitlabAccessToken`
 * just returns the stored token. We synthesize a minimal `cfg` so the REST
 * helpers (which only need `base` + `fetchImpl`) work without OAuth credentials.
 */
export const listRepoBranches = action({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.array(v.string()),
  handler: async (ctx, { linkId }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.gitlab.branchesAction.branchFetchContext,
      { linkId },
    );
    if (!cfg) return [];
    const token = await getValidGitlabAccessToken(ctx, cfg.credentialRef);
    if (!token) return [];
    const apiCfg: GitlabOAuthConfig = gitlabOAuthFromEnv() ?? {
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      base: GITLAB_BASE,
    };
    try {
      return await fetchBranches({
        cfg: apiCfg,
        accessToken: token,
        projectId: cfg.externalProjectId,
      });
    } catch (err) {
      console.error("[gitlab/branchesAction] fetchBranches failed", err);
      return [];
    }
  },
});

export const branchFetchContext = internalQuery({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.union(
    v.null(),
    v.object({
      credentialRef: v.string(),
      externalProjectId: v.string(),
    }),
  ),
  handler: async (ctx, { linkId }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });
    const integration = await getIntegrationForLink(ctx, link);
    if (!integration || integration.provider !== "gitlab") return null;
    return {
      credentialRef: integration.externalAccountId,
      externalProjectId: link.externalRepoId,
    };
  },
});
