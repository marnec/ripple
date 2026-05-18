"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { GithubClient } from "./client";

interface GithubIssueResponse {
  node_id: string;
  number: number;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | null;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string; avatar_url: string; html_url: string };
  labels?: { name: string }[];
  assignees?: { login: string; avatar_url: string; html_url: string }[];
}

/**
 * Force resync action. Iterates every `taskIntegrationLinks` row under the
 * given project link, fetches the current GitHub issue state per row, and
 * applies a synthesized `NormalizedIssueEvent` so the existing inbound
 * reconciliation path drives open/close + label + assignee convergence.
 *
 * Scheduled by the public `forceResync` mutation. Re-checks the link's
 * resync eligibility — a link that became frozen/disconnected between
 * mutation-time and execution-time is skipped silently.
 *
 * Per-issue fetch failures are logged and skipped — Force resync is a
 * best-effort recovery path, not a transactional reconciliation. Surfaces
 * that need stronger guarantees should use the audit log to follow up.
 */
export const runForceResync = internalAction({
  args: { projectIntegrationLinkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      console.error("[forceResync] GitHub App credentials not configured");
      return null;
    }

    const context = await ctx.runQuery(
      internal.integrations.core.forceResyncQueries.getResyncContext,
      { projectIntegrationLinkId: args.projectIntegrationLinkId },
    );
    if (!context) return null;

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(context.installationId);

    for (const item of context.items) {
      const res = await client.request<GithubIssueResponse>({
        installationToken: token,
        method: "GET",
        path: `/repos/${context.repoFullName}/issues/${item.issueNumber}`,
      });
      if (res.status !== 200 || !res.body) {
        console.warn(
          `[forceResync] issue fetch failed (status=${res.status}) for #${item.issueNumber}`,
        );
        continue;
      }

      const issue = res.body;
      await ctx.runMutation(
        internal.integrations.core.forceResync.applyOneIssueReconciliation,
        {
          projectIntegrationLinkId: args.projectIntegrationLinkId,
          rippleCompleted: item.completed,
          issue: {
            externalIssueId: issue.node_id,
            issueNumber: issue.number,
            state: issue.state,
            stateReason: issue.state_reason ?? null,
            title: issue.title,
            body: issue.body ?? "",
            url: issue.html_url,
            externalAuthor: {
              login: issue.user.login,
              avatarUrl: issue.user.avatar_url,
              url: issue.user.html_url,
            },
            labels: (issue.labels ?? []).map((l) => l.name),
            assignees: (issue.assignees ?? []).map((u) => ({
              login: u.login,
              avatarUrl: u.avatar_url,
              url: u.html_url,
            })),
          },
        },
      );
    }
    return null;
  },
});
