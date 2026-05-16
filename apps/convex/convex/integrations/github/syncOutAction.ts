"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  classifyResponse,
  type OutboundResponse,
} from "../core/syncOut";
import { GithubClient } from "./client";

/**
 * Outbound dispatch action. Scheduled via the `@convex-dev/action-retrier`
 * component so retry/backoff is owned by the substrate; this body owns the
 * classification + side effects per attempt.
 *
 * Contract with the retrier:
 *  - `return` cleanly → retrier stops (either success or permanent fail).
 *  - `throw`         → retrier backs off and retries.
 *
 * Pre-conditions (must hold at scheduling time, checked again here):
 *  - Link is sync-active (`shouldSkipForFreeze` ⇒ skip).
 *  - Desired state differs from `externalState` (`shouldSkipForEcho` ⇒ skip).
 *
 * On 2xx: record success (clear `lastSyncError`, update `externalState`).
 * On 4xx non-429: record permanent failure (`lastSyncError`).
 * On 5xx / network: throw → retrier retries.
 * On 429: pre-sleep `Retry-After` then throw — retrier adds its own backoff
 *         on top, which over-respects rather than under-respects the server.
 */
export const pushIssueState = internalAction({
  args: {
    taskId: v.id("tasks"),
    desiredState: v.union(v.literal("open"), v.literal("closed")),
    desiredStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    /** Pre-resolved at scheduling time. */
    installationId: v.string(),
    /** `owner/repo` — never the stable id; GitHub's REST takes the name. */
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordOutboundFailure,
        {
          taskId: args.taskId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    const body: Record<string, string> = { state: args.desiredState };
    if (args.desiredState === "closed" && args.desiredStateReason) {
      body.state_reason = args.desiredStateReason;
    }

    const res = await client.request<unknown>({
      installationToken: token,
      method: "PATCH",
      path: `/repos/${args.repoFullName}/issues/${args.issueNumber}`,
      body,
    });

    const normalized: OutboundResponse = {
      status: res.status as number | null,
      retryAfterMs: res.retryAfterMs,
      errorMessage: res.errorMessage,
    };
    const decision = classifyResponse(normalized);

    if (decision === "success") {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordOutboundSuccess,
        {
          taskId: args.taskId,
          newExternalState: args.desiredState,
          newExternalStateReason:
            args.desiredState === "closed"
              ? args.desiredStateReason ?? "completed"
              : undefined,
        },
      );
      return null;
    }

    if (decision === "permanent_fail") {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordOutboundFailure,
        {
          taskId: args.taskId,
          message: normalized.errorMessage ?? `HTTP ${normalized.status}`,
          httpStatus:
            typeof normalized.status === "number" ? normalized.status : undefined,
        },
      );
      return null;
    }

    // decision === "retry"
    if (res.status === 429 && normalized.retryAfterMs) {
      await new Promise((r) => setTimeout(r, normalized.retryAfterMs));
    }
    throw new Error(
      `GitHub outbound transient failure (status=${normalized.status}); retrier will back off`,
    );
  },
});

/**
 * Outbound label dispatch. Posts `add` labels and deletes `remove` labels on
 * the linked GitHub issue. On full success records the post-change
 * `nextLabels` set as the new `externalLabels` mirror — that mirror is what
 * the inbound echo guard compares against when GitHub's webhook bounces back.
 *
 * Retry/permanent-fail classification matches `pushIssueState`: any
 * permanent failure on any sub-call records `lastSyncError` and returns;
 * any retryable failure throws so the action-retrier backs off and re-runs
 * the whole batch (idempotent — POST/DELETE label by name produces no
 * per-call duplicates).
 */
export const pushLabelChanges = internalAction({
  args: {
    taskId: v.id("tasks"),
    add: v.array(v.string()),
    remove: v.array(v.string()),
    nextLabels: v.array(v.string()),
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordOutboundFailure,
        {
          taskId: args.taskId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    // POST /repos/:owner/:repo/issues/:n/labels — body { labels: [...] }
    // auto-creates labels missing on the repo.
    if (args.add.length > 0) {
      const res = await client.request<unknown>({
        installationToken: token,
        method: "POST",
        path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/labels`,
        body: { labels: args.add },
      });
      const decision = classifyResponse({
        status: res.status as number | null,
        retryAfterMs: res.retryAfterMs,
        errorMessage: res.errorMessage,
      });
      if (decision === "permanent_fail") {
        await ctx.runMutation(
          internal.integrations.github.syncOutMutations.recordOutboundFailure,
          {
            taskId: args.taskId,
            message: res.errorMessage ?? `HTTP ${res.status} on label add`,
            httpStatus: typeof res.status === "number" ? res.status : undefined,
          },
        );
        return null;
      }
      if (decision === "retry") {
        if (res.status === 429 && res.retryAfterMs) {
          await new Promise((r) => setTimeout(r, res.retryAfterMs));
        }
        throw new Error(
          `GitHub label-add transient failure (status=${res.status}); retrier will back off`,
        );
      }
    }

    // DELETE /repos/:owner/:repo/issues/:n/labels/:name per removed label.
    for (const name of args.remove) {
      const res = await client.request<unknown>({
        installationToken: token,
        method: "DELETE",
        path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/labels/${encodeURIComponent(name)}`,
      });
      // 404 on DELETE means the label was already absent on GitHub — treat
      // as success so we don't surface a "Sync failed" affordance for a
      // benign race (e.g. someone removed the label on GitHub first).
      if (res.status === 404) continue;
      const decision = classifyResponse({
        status: res.status as number | null,
        retryAfterMs: res.retryAfterMs,
        errorMessage: res.errorMessage,
      });
      if (decision === "permanent_fail") {
        await ctx.runMutation(
          internal.integrations.github.syncOutMutations.recordOutboundFailure,
          {
            taskId: args.taskId,
            message: res.errorMessage ?? `HTTP ${res.status} on label remove`,
            httpStatus: typeof res.status === "number" ? res.status : undefined,
          },
        );
        return null;
      }
      if (decision === "retry") {
        if (res.status === 429 && res.retryAfterMs) {
          await new Promise((r) => setTimeout(r, res.retryAfterMs));
        }
        throw new Error(
          `GitHub label-remove transient failure (status=${res.status}); retrier will back off`,
        );
      }
    }

    await ctx.runMutation(
      internal.integrations.github.syncOutMutations.recordLabelsSuccess,
      { taskId: args.taskId, nextLabels: args.nextLabels },
    );
    return null;
  },
});

/**
 * Outbound assignee dispatch. Mirrors `pushLabelChanges`: POSTs `add` logins
 * and DELETEs `remove` logins on the linked GitHub issue. GitHub's API
 * accepts up to 10 assignees in a single POST/DELETE call but rejects logins
 * outside the repo's collaborators — those return as 422 here, classified as
 * permanent failures (a misconfigured identity mapping isn't transient).
 *
 * On full success records `nextLogins` as the new `externalAssigneeLogins`
 * mirror so the inbound echo guard catches GitHub's bounced-back webhook.
 */
export const pushAssigneeChanges = internalAction({
  args: {
    taskId: v.id("tasks"),
    add: v.array(v.string()),
    remove: v.array(v.string()),
    nextLogins: v.array(v.string()),
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordOutboundFailure,
        {
          taskId: args.taskId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    if (args.add.length > 0) {
      const res = await client.request<unknown>({
        installationToken: token,
        method: "POST",
        path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/assignees`,
        body: { assignees: args.add },
      });
      const decision = classifyResponse({
        status: res.status as number | null,
        retryAfterMs: res.retryAfterMs,
        errorMessage: res.errorMessage,
      });
      if (decision === "permanent_fail") {
        await ctx.runMutation(
          internal.integrations.github.syncOutMutations.recordOutboundFailure,
          {
            taskId: args.taskId,
            message: res.errorMessage ?? `HTTP ${res.status} on assignee add`,
            httpStatus: typeof res.status === "number" ? res.status : undefined,
          },
        );
        return null;
      }
      if (decision === "retry") {
        if (res.status === 429 && res.retryAfterMs) {
          await new Promise((r) => setTimeout(r, res.retryAfterMs));
        }
        throw new Error(
          `GitHub assignee-add transient failure (status=${res.status}); retrier will back off`,
        );
      }
    }

    if (args.remove.length > 0) {
      const res = await client.request<unknown>({
        installationToken: token,
        method: "DELETE",
        path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/assignees`,
        body: { assignees: args.remove },
      });
      const decision = classifyResponse({
        status: res.status as number | null,
        retryAfterMs: res.retryAfterMs,
        errorMessage: res.errorMessage,
      });
      if (decision === "permanent_fail") {
        await ctx.runMutation(
          internal.integrations.github.syncOutMutations.recordOutboundFailure,
          {
            taskId: args.taskId,
            message: res.errorMessage ?? `HTTP ${res.status} on assignee remove`,
            httpStatus: typeof res.status === "number" ? res.status : undefined,
          },
        );
        return null;
      }
      if (decision === "retry") {
        if (res.status === 429 && res.retryAfterMs) {
          await new Promise((r) => setTimeout(r, res.retryAfterMs));
        }
        throw new Error(
          `GitHub assignee-remove transient failure (status=${res.status}); retrier will back off`,
        );
      }
    }

    await ctx.runMutation(
      internal.integrations.github.syncOutMutations.recordAssigneesSuccess,
      { taskId: args.taskId, nextLogins: args.nextLogins },
    );
    return null;
  },
});

/**
 * Outbound comment-create action. POSTs the Ripple-side body to GitHub's
 * `/repos/:owner/:repo/issues/:n/comments` endpoint, and on 2xx writes a
 * `taskCommentIntegrationLinks` row keyed on the returned GitHub comment id.
 * Failures land on `taskComments.lastSyncError` so the UI can surface a
 * "⚠ Sync failed — Retry" affordance.
 *
 * Pre-condition: the calling dispatcher resolved the task's
 * `taskIntegrationLinks` row and passed its id; the link row's existence is
 * assumed by the success recorder.
 */
export const pushCommentCreate = internalAction({
  args: {
    commentId: v.id("taskComments"),
    body: v.string(),
    taskIntegrationLinkId: v.id("taskIntegrationLinks"),
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentCreateFailure,
        {
          commentId: args.commentId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    const res = await client.request<{
      id: number;
      node_id: string;
      updated_at: string;
      user: { login: string; avatar_url: string; html_url: string };
    }>({
      installationToken: token,
      method: "POST",
      path: `/repos/${args.repoFullName}/issues/${args.issueNumber}/comments`,
      body: { body: args.body },
    });

    const normalized: OutboundResponse = {
      status: res.status as number | null,
      retryAfterMs: res.retryAfterMs,
      errorMessage: res.errorMessage,
    };
    const decision = classifyResponse(normalized);

    if (decision === "success" && res.body) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentCreateSuccess,
        {
          commentId: args.commentId,
          taskIntegrationLinkId: args.taskIntegrationLinkId,
          externalCommentId: String(res.body.id),
          externalUpdatedAt: Date.parse(res.body.updated_at),
          externalAuthor: {
            login: res.body.user.login,
            avatarUrl: res.body.user.avatar_url,
            url: res.body.user.html_url,
          },
        },
      );
      return null;
    }

    if (decision === "permanent_fail") {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentCreateFailure,
        {
          commentId: args.commentId,
          message: normalized.errorMessage ?? `HTTP ${normalized.status}`,
          httpStatus:
            typeof normalized.status === "number" ? normalized.status : undefined,
        },
      );
      return null;
    }

    if (res.status === 429 && normalized.retryAfterMs) {
      await new Promise((r) => setTimeout(r, normalized.retryAfterMs));
    }
    throw new Error(
      `GitHub comment-create transient failure (status=${normalized.status}); retrier will back off`,
    );
  },
});

/**
 * Outbound comment-edit action. PATCHes the body of an existing GitHub
 * issue comment. The `externalCommentId` is the numeric REST id stored on
 * the link row at create-success time.
 */
export const pushCommentEdit = internalAction({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalCommentId: v.string(),
    body: v.string(),
    installationId: v.string(),
    repoFullName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        {
          commentLinkId: args.commentLinkId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    const res = await client.request<{ updated_at: string }>({
      installationToken: token,
      method: "PATCH",
      path: `/repos/${args.repoFullName}/issues/comments/${args.externalCommentId}`,
      body: { body: args.body },
    });

    const normalized: OutboundResponse = {
      status: res.status as number | null,
      retryAfterMs: res.retryAfterMs,
      errorMessage: res.errorMessage,
    };
    const decision = classifyResponse(normalized);

    if (decision === "success" && res.body) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentEditSuccess,
        {
          commentLinkId: args.commentLinkId,
          externalUpdatedAt: Date.parse(res.body.updated_at),
        },
      );
      return null;
    }

    if (decision === "permanent_fail") {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        {
          commentLinkId: args.commentLinkId,
          message: normalized.errorMessage ?? `HTTP ${normalized.status}`,
          httpStatus:
            typeof normalized.status === "number" ? normalized.status : undefined,
        },
      );
      return null;
    }

    if (res.status === 429 && normalized.retryAfterMs) {
      await new Promise((r) => setTimeout(r, normalized.retryAfterMs));
    }
    throw new Error(
      `GitHub comment-edit transient failure (status=${normalized.status}); retrier will back off`,
    );
  },
});

/**
 * Outbound comment-delete action. DELETEs the GitHub-side comment. A 404
 * is treated as success — the comment was already gone (someone deleted it
 * on GitHub first), and surfacing a "Sync failed" badge for a benign race
 * would be noise.
 */
export const pushCommentDelete = internalAction({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalCommentId: v.string(),
    installationId: v.string(),
    repoFullName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPem = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKeyPem) {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        {
          commentLinkId: args.commentLinkId,
          message: "GitHub App credentials not configured",
          httpStatus: undefined,
        },
      );
      return null;
    }

    const client = new GithubClient({ appId, privateKeyPem });
    const token = await client.mintInstallationToken(args.installationId);

    const res = await client.request<unknown>({
      installationToken: token,
      method: "DELETE",
      path: `/repos/${args.repoFullName}/issues/comments/${args.externalCommentId}`,
    });

    if (res.status === 404 || (typeof res.status === "number" && res.status >= 200 && res.status < 300)) {
      // Clear lastSyncError on the link row — the delete succeeded (or was
      // a benign no-op). We deliberately leave the link row in place so a
      // future webhook delivery for the same externalCommentId can be
      // deduped via the existing by_externalCommentId index.
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentDeleteSuccess,
        { commentLinkId: args.commentLinkId },
      );
      return null;
    }

    const normalized: OutboundResponse = {
      status: res.status as number | null,
      retryAfterMs: res.retryAfterMs,
      errorMessage: res.errorMessage,
    };
    const decision = classifyResponse(normalized);

    if (decision === "permanent_fail") {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        {
          commentLinkId: args.commentLinkId,
          message: normalized.errorMessage ?? `HTTP ${normalized.status}`,
          httpStatus:
            typeof normalized.status === "number" ? normalized.status : undefined,
        },
      );
      return null;
    }

    if (res.status === 429 && normalized.retryAfterMs) {
      await new Promise((r) => setTimeout(r, normalized.retryAfterMs));
    }
    throw new Error(
      `GitHub comment-delete transient failure (status=${normalized.status}); retrier will back off`,
    );
  },
});
