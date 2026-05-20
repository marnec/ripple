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
 * Issues processed per action invocation. Bounds both wall-clock time and
 * GitHub API budget burn for one tick — the action self-reschedules to drain
 * the rest, so a 5000-issue project no longer fires 5000 sequential GETs
 * inside a single (potentially timing-out) action.
 */
const RESYNC_BATCH_SIZE = 25;

/** Fallback pause when a 429 carries no parseable `Retry-After`. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * Force resync action. Fetches the current GitHub issue state for each
 * `taskIntegrationLinks` row under the given project link and applies a
 * synthesized `NormalizedIssueEvent` so the existing inbound reconciliation
 * path drives open/close + label + assignee convergence.
 *
 * Scheduled by the public `forceResync` mutation. Drains in bounded batches
 * of `RESYNC_BATCH_SIZE`, self-rescheduling at `offset + batch` until the
 * link's items are exhausted (the `drainImportBatch` pattern). Each batch
 * re-reads `getResyncContext`, which re-checks resync eligibility — a link
 * that becomes frozen/disconnected mid-drain stops the remaining batches.
 *
 * Rate limits: on a 429 the batch stops and reschedules from the failing
 * item's absolute offset after the server's `Retry-After` delay, so one
 * resync can't hammer the App's hourly budget. Other per-issue fetch
 * failures are logged and skipped — Force resync is a best-effort recovery
 * path, not a transaction.
 */
export const runForceResync = internalAction({
  args: {
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    // Index into `getResyncContext().items` to resume from. Omitted on the
    // first invocation (the `forceResync` mutation schedules without it).
    offset: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const offset = args.offset ?? 0;

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

    const slice = context.items.slice(offset, offset + RESYNC_BATCH_SIZE);
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      const res = await client.request<GithubIssueResponse>({
        installationToken: token,
        method: "GET",
        path: `/repos/${context.repoFullName}/issues/${item.issueNumber}`,
      });

      // Rate-limited: stop the batch and resume this same item on a fresh
      // invocation after GitHub's cool-off. Items earlier in this slice were
      // already applied (the apply step is idempotent), so resuming from the
      // failing absolute index neither double-applies nor skips.
      if (res.status === 429) {
        await ctx.scheduler.runAfter(
          res.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS,
          internal.integrations.github.forceResyncAction.runForceResync,
          {
            projectIntegrationLinkId: args.projectIntegrationLinkId,
            offset: offset + i,
          },
        );
        return null;
      }

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

    // More items remain → schedule the next batch from the new offset.
    if (offset + slice.length < context.items.length) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.github.forceResyncAction.runForceResync,
        {
          projectIntegrationLinkId: args.projectIntegrationLinkId,
          offset: offset + slice.length,
        },
      );
    }
    return null;
  },
});
