"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";
import { GithubClient } from "./client";
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
      api.integrations.core.install.assertWizardInstallation,
      args,
    );

    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      throw new Error("GitHub App credentials not configured");
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.externalAccountId);
    const res = await client.request<RawRepoListResponse>({
      installationToken: token,
      method: "GET",
      path: "/installation/repositories?per_page=100",
    });
    if (res.status !== 200 || !res.body) {
      throw new Error(`GitHub repo list failed (status=${res.status})`);
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
      api.integrations.core.install.assertWizardInstallation,
      { workspaceId: args.workspaceId, externalAccountId: args.externalAccountId },
    );

    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      throw new Error("GitHub App credentials not configured");
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.externalAccountId);
    const q = buildIssueSearchQuery({
      repoFullName: args.repoFullName,
      includeClosed: args.includeClosed,
      labels: args.labels,
    });
    const res = await client.request<{ total_count?: number }>({
      installationToken: token,
      method: "GET",
      path: `/search/issues?per_page=1&q=${encodeURIComponent(q)}`,
    });
    if (res.status !== 200 || !res.body) {
      throw new Error(`GitHub issue count failed (status=${res.status})`);
    }
    return { count: res.body.total_count ?? 0 };
  },
});
