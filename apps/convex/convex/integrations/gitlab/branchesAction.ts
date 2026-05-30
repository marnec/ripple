import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  requireResourceMember,
  requireWorkspaceMember,
} from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getIntegrationForLink } from "../core/integrationLookups";
import { branchNameForIssue } from "../core/branchNaming";
import {
  GITLAB_BASE,
  type GitlabOAuthConfig,
  createBranch,
  fetchBranches,
  fetchProjectDefaultBranch,
  gitlabOAuthFromEnv,
} from "./oauthClient";
import { getValidGitlabAccessToken } from "./tokenClient";

/**
 * Synthesize the minimal `GitlabOAuthConfig` the REST helpers need (`base` +
 * `fetchImpl`). OAuth env vars are NOT required for PAT installs — the helpers
 * only carry the credentials for the OAuth *flow*, not for authenticated REST
 * calls (those use the access token directly). Falls back to gitlab.com.
 */
function gitlabApiCfg(): GitlabOAuthConfig {
  return (
    gitlabOAuthFromEnv() ?? {
      clientId: "",
      clientSecret: "",
      redirectUri: "",
      base: GITLAB_BASE,
    }
  );
}

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
    try {
      return await fetchBranches({
        cfg: gitlabApiCfg(),
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

/**
 * Resolve the data needed to create a branch for a task's linked GitLab issue,
 * gated on task (workspace) membership. The GitLab analog of GitHub's
 * `branchCreateContext`: the issue iid + project come from the task's single
 * integration link (`taskIntegrationLinks` is unique `by_task`); the GitLab
 * numeric project id is the project link's `externalRepoId` (per schema).
 * Returns null when the task isn't linked to a live GitLab issue.
 */
export const branchCreateContext = internalQuery({
  args: { taskId: v.id("tasks") },
  returns: v.union(
    v.null(),
    v.object({
      credentialRef: v.string(),
      externalProjectId: v.string(),
      issueNumber: v.number(),
      title: v.string(),
      linkId: v.id("taskIntegrationLinks"),
      existingBranchName: v.union(v.string(), v.null()),
      defaultBaseBranch: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { taskId }) => {
    await requireResourceMember(ctx, "tasks", taskId);
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique();
    if (!link || link.externalDeletedAt !== undefined) return null;
    const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
    if (!projectLink) return null;
    const integration = await getIntegrationForLink(ctx, projectLink);
    if (!integration || integration.provider !== "gitlab") return null;
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const ref = (task.externalRefs ?? []).find(
      (r) => r.repoFullName === projectLink.externalRepoFullName,
    );
    if (!ref) return null;
    return {
      credentialRef: integration.externalAccountId,
      externalProjectId: projectLink.externalRepoId,
      issueNumber: ref.issueNumber,
      title: task.title,
      linkId: link._id,
      existingBranchName: link.branchName ?? null,
      defaultBaseBranch: projectLink.defaultBaseBranch ?? null,
    };
  },
});

/**
 * Branch sources for a task's "Create branch" picker (GitLab). Task-membership
 * gated via `branchCreateContext`. Mirrors GitHub's `listTaskRepoBranches`:
 * returns the project's branch names + its default branch (to label/preselect),
 * degrading to empty/null on any resolution failure.
 */
export const listTaskRepoBranches = action({
  args: { taskId: v.id("tasks") },
  returns: v.object({
    branches: v.array(v.string()),
    defaultBranch: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { taskId }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.gitlab.branchesAction.branchCreateContext,
      { taskId },
    );
    if (!cfg) return { branches: [], defaultBranch: null };
    const token = await getValidGitlabAccessToken(ctx, cfg.credentialRef);
    if (!token) return { branches: [], defaultBranch: null };
    const apiCfg = gitlabApiCfg();
    try {
      const [branches, defaultBranch] = await Promise.all([
        fetchBranches({
          cfg: apiCfg,
          accessToken: token,
          projectId: cfg.externalProjectId,
        }),
        fetchProjectDefaultBranch({
          cfg: apiCfg,
          accessToken: token,
          projectId: cfg.externalProjectId,
        }),
      ]);
      return { branches, defaultBranch };
    } catch (err) {
      console.error("[gitlab/branchesAction] listTaskRepoBranches failed", err);
      return { branches: [], defaultBranch: null };
    }
  },
});

/**
 * Create a git branch for a task's linked GitLab issue, named
 * `<issueIid>-<slug>` (the shared convention that lets an MR opened from the
 * branch auto-link to the task). Base resolution mirrors GitHub:
 * explicit `baseBranch` arg → the project link's `defaultBaseBranch` → the
 * project's default branch. User-initiated, so it runs synchronously and throws
 * a `ConvexError` the UI surfaces. Idempotent: a pre-recorded branch is returned
 * as-is, and a GitLab "already exists" is adopted rather than failing.
 */
export const createBranchForTask = action({
  args: {
    taskId: v.id("tasks"),
    baseBranch: v.optional(v.string()),
  },
  returns: v.object({
    branchName: v.string(),
    baseBranch: v.string(),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, { taskId, baseBranch }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.gitlab.branchesAction.branchCreateContext,
      { taskId },
    );
    if (!cfg) throw new ConvexError("This task isn't linked to a GitLab issue");

    const token = await getValidGitlabAccessToken(ctx, cfg.credentialRef);
    if (!token) throw new ConvexError("GitLab credentials not configured");
    const apiCfg = gitlabApiCfg();
    const branchName = branchNameForIssue(cfg.issueNumber, cfg.title);

    // Resolve the base: explicit arg → project default → repo default.
    let base = baseBranch ?? cfg.defaultBaseBranch ?? undefined;
    if (!base) {
      base =
        (await fetchProjectDefaultBranch({
          cfg: apiCfg,
          accessToken: token,
          projectId: cfg.externalProjectId,
        })) ?? undefined;
      if (!base) {
        throw new ConvexError("Couldn't resolve the project's default branch");
      }
    }

    // A pre-recorded branch short-circuits — but only after `base` is resolved
    // so the return type's `baseBranch` is always a concrete string.
    if (cfg.existingBranchName) {
      return {
        branchName: cfg.existingBranchName,
        baseBranch: base,
        alreadyExisted: true,
      };
    }

    let alreadyExisted = false;
    try {
      const res = await createBranch({
        cfg: apiCfg,
        accessToken: token,
        projectId: cfg.externalProjectId,
        branch: branchName,
        ref: base,
      });
      alreadyExisted = res.alreadyExisted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b40[13]\b/.test(msg)) {
        throw new ConvexError(
          "GitLab denied branch creation. The token needs the `write_repository` scope and Developer+ role on the project.",
        );
      }
      throw new ConvexError(msg);
    }

    await ctx.runMutation(
      internal.integrations.core.branchesAction.recordTaskBranchName,
      { linkId: cfg.linkId, taskId, branchName, baseBranch: base },
    );
    return { branchName, baseBranch: base, alreadyExisted };
  },
});
