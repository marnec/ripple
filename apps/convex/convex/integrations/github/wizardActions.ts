"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { githubClientFromEnv } from "./client";
import { buildIssueSearchQuery, shapeRepos } from "./wizardHelpers";

interface RawRepoListResponse {
  repositories?: { node_id: string; full_name: string; private: boolean }[];
}

/**
 * List the repositories an installation can access — the wizard's repo
 * picker. Admin-gated via `assertWizardInstallation` (propagated identity),
 * then a single `/installation/repositories` fetch with the installation
 * token. Returns up to 100 repos (one page); pagination is deferred — most
 * installations scope to a handful of repos.
 */
export const listInstallationRepos = action({
  args: { workspaceId: v.id("workspaces"), externalAccountId: v.string() },
  returns: v.array(
    v.object({
      externalRepoId: v.string(),
      fullName: v.string(),
      private: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await ctx.runQuery(
      internal.integrations.core.install.assertWizardInstallation,
      {
        workspaceId: args.workspaceId,
        externalAccountId: args.externalAccountId,
        provider: "github",
      },
    );

    // ConvexError, not Error: Convex redacts a plain throw to "Server Error"
    // in production, and these are the two things a wizard admin can actually
    // act on — set the App credentials, or reconnect a revoked installation.
    const client = githubClientFromEnv();
    if (!client) {
      throw new ConvexError("GitHub App credentials are not configured");
    }

    const res = await client
      .forInstallation(args.externalAccountId)
      .request<RawRepoListResponse>({
        method: "GET",
        path: "/installation/repositories?per_page=100",
      });
    if (res.status !== 200 || !res.body) {
      // The upstream status goes to the log, not to the toast — a raw GitHub
      // response detail is not something to render into the UI.
      console.error("GitHub repo list failed", { status: res.status });
      throw new ConvexError(
        "Could not list repositories from GitHub. Check the installation is still authorized and try again.",
      );
    }
    return shapeRepos(res.body.repositories ?? []);
  },
});

/**
 * Preview how many issues an import would ingest for the chosen repo +
 * filters, via the GitHub Search API's `total_count`. Admin-gated. Used by
 * the wizard's preview step so the admin isn't surprised by volume.
 */
export const previewImportCount = action({
  args: {
    workspaceId: v.id("workspaces"),
    externalAccountId: v.string(),
    repoFullName: v.string(),
    includeClosed: v.boolean(),
    labels: v.array(v.string()),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    await ctx.runQuery(
      internal.integrations.core.install.assertWizardInstallation,
      {
        workspaceId: args.workspaceId,
        externalAccountId: args.externalAccountId,
        provider: "github",
      },
    );

    const client = githubClientFromEnv();
    if (!client) {
      throw new ConvexError("GitHub App credentials are not configured");
    }

    const q = buildIssueSearchQuery({
      repoFullName: args.repoFullName,
      includeClosed: args.includeClosed,
      labels: args.labels,
    });
    const res = await client
      .forInstallation(args.externalAccountId)
      .request<{ total_count?: number }>({
        method: "GET",
        path: `/search/issues?per_page=1&q=${encodeURIComponent(q)}`,
      });
    if (res.status !== 200 || !res.body) {
      console.error("GitHub issue count failed", { status: res.status });
      throw new ConvexError(
        "Could not count issues on GitHub. Check the installation is still authorized and try again.",
      );
    }
    return { count: res.body.total_count ?? 0 };
  },
});
