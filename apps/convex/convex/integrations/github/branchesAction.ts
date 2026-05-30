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
    const integration = await getIntegrationForLink(ctx, link);
    if (!integration) return null;
    const [owner, repo] = link.externalRepoFullName.split("/");
    if (!owner || !repo) return null;
    return { externalAccountId: integration.externalAccountId, owner, repo };
  },
});

/**
 * Resolve the data needed to create a git branch for a task's linked issue,
 * gated on task (workspace) membership. Returns null when the task isn't linked
 * to a live GitHub issue. `existingBranchName` short-circuits re-creation.
 */
export const branchCreateContext = internalQuery({
  args: { taskId: v.id("tasks") },
  returns: v.union(
    v.null(),
    v.object({
      externalAccountId: v.string(),
      owner: v.string(),
      repo: v.string(),
      issueNumber: v.number(),
      title: v.string(),
      linkId: v.id("taskIntegrationLinks"),
      existingBranchName: v.union(v.string(), v.null()),
      // Project-configured default base, or null to fall back to repo default.
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
    if (!integration) return null;
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const ref = (task.externalRefs ?? []).find(
      (r) => r.repoFullName === projectLink.externalRepoFullName,
    );
    if (!ref) return null;
    const [owner, repo] = projectLink.externalRepoFullName.split("/");
    if (!owner || !repo) return null;
    return {
      externalAccountId: integration.externalAccountId,
      owner,
      repo,
      issueNumber: ref.issueNumber,
      title: task.title,
      linkId: link._id,
      existingBranchName: link.branchName ?? null,
      defaultBaseBranch: projectLink.defaultBaseBranch ?? null,
    };
  },
});

/**
 * Branch sources for a task's "Create branch" picker: the repo's branch names
 * plus its default branch (to label/preselect). Task-membership gated (via
 * `branchCreateContext`), unlike the admin-only `listRepoBranches` used by the
 * project-settings editor. Returns empty/null on any resolution failure so the
 * picker degrades to free choice.
 */
export const listTaskRepoBranches = action({
  args: { taskId: v.id("tasks") },
  returns: v.object({
    branches: v.array(v.string()),
    defaultBranch: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { taskId }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.github.branchesAction.branchCreateContext,
      { taskId },
    );
    if (!cfg) return { branches: [], defaultBranch: null };

    const client = githubClientFromEnv();
    if (!client) return { branches: [], defaultBranch: null };
    const gh = client.forInstallation(cfg.externalAccountId);

    const branches = await gh.fetchBranches({ owner: cfg.owner, repo: cfg.repo });
    const repoRes = await gh.request<{ default_branch: string }>({
      method: "GET",
      path: `/repos/${cfg.owner}/${cfg.repo}`,
    });
    return {
      branches,
      defaultBranch: repoRes.body?.default_branch ?? null,
    };
  },
});

/**
 * Create a git branch for a task's linked GitHub issue, named
 * `<issueNumber>-<slug>`. The base it's cut from is resolved in priority order:
 * an explicit `baseBranch` arg (the task picker's per-creation choice) → the
 * project link's `defaultBaseBranch` → the repo's default branch. User-initiated,
 * so it runs synchronously (not via the retrier) and throws a `ConvexError` the
 * UI can surface. Idempotent: a pre-recorded branch is returned as-is, and a
 * "reference already exists" on GitHub is adopted rather than failing.
 *
 * Requires the App's `Contents: write` permission — a 403 maps to a clear
 * "accept the updated permission" message.
 */
export const createBranchForTask = action({
  args: {
    taskId: v.id("tasks"),
    // Explicit base to branch from; falls back to the project default, then the
    // repo default. An unknown branch surfaces as a clear "couldn't read head".
    baseBranch: v.optional(v.string()),
  },
  returns: v.object({
    branchName: v.string(),
    baseBranch: v.string(),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, { taskId, baseBranch }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.github.branchesAction.branchCreateContext,
      { taskId },
    );
    if (!cfg) {
      throw new ConvexError("This task isn't linked to a GitHub issue");
    }

    const client = githubClientFromEnv();
    if (!client) throw new ConvexError("GitHub App credentials not configured");
    const gh = client.forInstallation(cfg.externalAccountId);
    const branchName = branchNameForIssue(cfg.issueNumber, cfg.title);

    // Resolve the base: explicit arg → project default → repo default.
    let base = baseBranch ?? cfg.defaultBaseBranch ?? undefined;
    if (!base) {
      const repoRes = await gh.request<{ default_branch: string }>({
        method: "GET",
        path: `/repos/${cfg.owner}/${cfg.repo}`,
      });
      base = repoRes.body?.default_branch;
      if (repoRes.status !== 200 || !base) {
        throw new ConvexError(
          "Couldn't resolve the repository's default branch",
        );
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

    const refRes = await gh.request<{ object: { sha: string } }>({
      method: "GET",
      path: `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${base}`,
    });
    const sha = refRes.body?.object?.sha;
    if (refRes.status !== 200 || !sha) {
      throw new ConvexError(`Couldn't read the ${base} branch head`);
    }

    const createRes = await gh.request<unknown>({
      method: "POST",
      path: `/repos/${cfg.owner}/${cfg.repo}/git/refs`,
      body: { ref: `refs/heads/${branchName}`, sha },
    });

    let alreadyExisted = false;
    if (createRes.status === 422) {
      // "Reference already exists" — adopt it (idempotent re-click / manual).
      alreadyExisted = true;
    } else if (createRes.status === 403) {
      throw new ConvexError(
        "GitHub denied branch creation. The App needs 'Contents: write' — accept the updated permission on the installation, then retry.",
      );
    } else if (
      createRes.status === null ||
      createRes.status < 200 ||
      createRes.status >= 300
    ) {
      throw new ConvexError(
        createRes.errorMessage ??
          `GitHub returned ${createRes.status} creating the branch`,
      );
    }

    await ctx.runMutation(
      internal.integrations.core.branchesAction.recordTaskBranchName,
      { linkId: cfg.linkId, taskId, branchName, baseBranch: base },
    );
    return { branchName, baseBranch: base, alreadyExisted };
  },
});
