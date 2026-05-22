"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  filterImportEvents,
  type ImportFilterConfig,
} from "../core/importJob";
import type {
  NormalizedIssueClosedEvent,
  NormalizedIssueEvent,
  NormalizedIssueOpenedEvent,
} from "../core/types";
import { GithubClient } from "./client";

/**
 * Raw GitHub issue payload — the subset we read. GitHub's REST list
 * endpoint returns the same shape as webhook payloads' `issue` field.
 */
interface RawGithubIssue {
  node_id: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason?: "completed" | "not_planned" | null;
  html_url: string;
  updated_at: string;
  user: { login: string; avatar_url: string; html_url: string };
  pull_request?: unknown; // GitHub conflates PRs and issues on the list endpoint
}

/**
 * Pure helper: convert a fetched batch of raw GitHub issues into the
 * provider-neutral event shape. Pull requests are dropped (the REST list
 * endpoint returns PRs as "issues"; we skip them so they don't become
 * Ripple tasks).
 */
export function normalizeImportBatch(
  issues: readonly RawGithubIssue[],
): NormalizedIssueEvent[] {
  const out: NormalizedIssueEvent[] = [];
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const shared = {
      externalIssueId: issue.node_id,
      issueNumber: issue.number,
      externalUpdatedAt: Date.parse(issue.updated_at),
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
      externalAuthor: {
        login: issue.user.login,
        avatarUrl: issue.user.avatar_url,
        url: issue.user.html_url,
      },
    };
    if (issue.state === "closed") {
      const closed: NormalizedIssueClosedEvent = {
        kind: "issue.closed",
        ...shared,
        stateReason: issue.state_reason ?? "completed",
      };
      out.push(closed);
    } else {
      const opened: NormalizedIssueOpenedEvent = {
        kind: "issue.opened",
        ...shared,
      };
      out.push(opened);
    }
  }
  return out;
}

/**
 * Internal action that drives one drain step. Fetches a batch of GitHub
 * issues, normalizes + filters, hands the batch to
 * `core/importJob.applyImportBatch` via a single mutation, then schedules
 * the next page if more remain.
 */
export const drainImportBatch = internalAction({
  args: {
    jobId: v.id("taskImportJobs"),
    repoFullName: v.string(),
    externalAccountId: v.string(),
    sinceCursor: v.optional(v.string()),
    batchStartIndex: v.number(),
    includeClosed: v.boolean(),
    // Optional label filter (names). Threaded to GitHub's `labels=` param so
    // the import scopes to issues carrying at least one matching label.
    labels: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      console.error("[importDrain] GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not set");
      await ctx.runMutation(
        internal.integrations.github.importDrainMutations.markFailed,
        {
          jobId: args.jobId,
          message: "GitHub App credentials not configured",
        },
      );
      return null;
    }
    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.externalAccountId);

    // Paginated list — sorted ascending by updated_at so `since` cursor
    // monotonically advances.
    const params = new URLSearchParams({
      state: "all",
      per_page: "50",
      sort: "updated",
      direction: "asc",
    });
    if (args.sinceCursor) params.set("since", args.sinceCursor);
    if (args.labels && args.labels.length > 0) {
      params.set("labels", args.labels.join(","));
    }

    const res = await client.request<RawGithubIssue[]>({
      installationToken: token,
      method: "GET",
      path: `/repos/${args.repoFullName}/issues?${params.toString()}`,
    });

    if (res.status !== 200 || !res.body) {
      console.error(`[importDrain] fetch failed: ${res.status}`);
      await ctx.runMutation(
        internal.integrations.github.importDrainMutations.markFailed,
        {
          jobId: args.jobId,
          message: `GitHub fetch failed: ${res.status}`,
        },
      );
      return null;
    }

    const config: ImportFilterConfig = { includeClosed: args.includeClosed };
    const events = filterImportEvents(normalizeImportBatch(res.body), config);

    await ctx.runMutation(
      internal.integrations.github.importDrainMutations.applyBatch,
      {
        jobId: args.jobId,
        events,
        batchStartIndex: args.batchStartIndex,
      },
    );

    // GitHub returns a full page when more remain. Advance the cursor to
    // the last issue's updated_at and schedule the next batch.
    if (res.body.length === 50) {
      const last = res.body[res.body.length - 1];
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.github.importDrain.drainImportBatch,
        {
          ...args,
          sinceCursor: last.updated_at,
          batchStartIndex: args.batchStartIndex + events.length,
        },
      );
    } else {
      await ctx.runMutation(
        internal.integrations.github.importDrainMutations.markCompleted,
        { jobId: args.jobId },
      );
    }
    return null;
  },
});
