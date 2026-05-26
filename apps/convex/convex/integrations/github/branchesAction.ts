import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  requireResourceMember,
  requireWorkspaceMember,
} from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getWorkspaceIntegration } from "../core/integrationLookups";
import { logTaskIntegrationActivity } from "../core/integrationActivity";
import { githubClientFromEnv } from "./client";

/**
 * Conventional branch name for an issue: `<issueNumber>-<slug-of-title>`,
 * matching GitHub's own "create a branch for this issue" format. The leading
 * issue number is what lets a PR opened from this branch auto-link to the task
 * (see `parseBranchIssueNumber`) without a `Closes #N` keyword.
 */
export function branchNameForIssue(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug ? `${issueNumber}-${slug}` : `${issueNumber}`;
}

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
    const integration = await getWorkspaceIntegration(
      ctx,
      projectLink.workspaceId,
    );
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
    };
  },
});

/** Persist the created branch name on the task's link (drives the UI chip). */
export const recordTaskBranchName = internalMutation({
  args: {
    linkId: v.id("taskIntegrationLinks"),
    taskId: v.id("tasks"),
    branchName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { linkId, taskId, branchName }) => {
    const link = await ctx.db.get(linkId);
    if (!link) return null;
    await ctx.db.patch(linkId, { branchName });
    await logTaskIntegrationActivity(ctx, {
      taskId,
      type: "branch_created",
      newValue: branchName,
    });
    return null;
  },
});

/**
 * Create a git branch for a task's linked GitHub issue, off the repo's default
 * branch, named `<issueNumber>-<slug>`. User-initiated, so it runs
 * synchronously (not via the retrier) and throws a `ConvexError` the UI can
 * surface. Idempotent: a pre-recorded branch is returned as-is, and a
 * "reference already exists" on GitHub is adopted rather than failing.
 *
 * Requires the App's `Contents: write` permission — a 403 maps to a clear
 * "accept the updated permission" message.
 */
export const createBranchForTask = action({
  args: { taskId: v.id("tasks") },
  returns: v.object({
    branchName: v.string(),
    alreadyExisted: v.boolean(),
  }),
  handler: async (ctx, { taskId }) => {
    const cfg = await ctx.runQuery(
      internal.integrations.github.branchesAction.branchCreateContext,
      { taskId },
    );
    if (!cfg) {
      throw new ConvexError("This task isn't linked to a GitHub issue");
    }
    if (cfg.existingBranchName) {
      return { branchName: cfg.existingBranchName, alreadyExisted: true };
    }

    const client = githubClientFromEnv();
    if (!client) throw new ConvexError("GitHub App credentials not configured");
    const gh = client.forInstallation(cfg.externalAccountId);
    const branchName = branchNameForIssue(cfg.issueNumber, cfg.title);

    // Base the branch on the repo's default branch head.
    const repoRes = await gh.request<{ default_branch: string }>({
      method: "GET",
      path: `/repos/${cfg.owner}/${cfg.repo}`,
    });
    const base = repoRes.body?.default_branch;
    if (repoRes.status !== 200 || !base) {
      throw new ConvexError("Couldn't resolve the repository's default branch");
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
      internal.integrations.github.branchesAction.recordTaskBranchName,
      { linkId: cfg.linkId, taskId, branchName },
    );
    return { branchName, alreadyExisted };
  },
});
