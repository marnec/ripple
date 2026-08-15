import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getValidGitlabAccessToken } from "./tokenClient";
import { makeGitlabRequester } from "./outboundGateway";
import {
  describeError,
  recordForceResyncGaveUp,
} from "../core/forceResyncFailure";

/**
 * GitLab force-resync adapter — the mirror of `github/forceResyncAction`, and
 * the `gitlab` row of `core/resyncAdapters`. Fetches each linked issue's current
 * GitLab truth and hands it to the shared
 * `core/forceResync.applyOneIssueReconciliation`, so every reconciliation rule
 * (forward-only status, label naming, assignee matching) stays in core and this
 * file owns only the provider's wire format.
 *
 * GitLab differences from the GitHub action, all confined here:
 *  - auth is a bearer token from the refresh-on-demand `tokenClient`, not an
 *    App installation JWT;
 *  - the project is addressed by its stable numeric id (`externalRepoId`), not
 *    `owner/repo` — GitLab paths accept either, and the id survives renames;
 *  - `state` is `opened`/`closed` and there is no completed/not_planned reason;
 *  - `labels` is a plain string array;
 *  - assignees carry the numeric `id` GitLab's identity path matches members on.
 *
 * Failure handling is shared, not mirrored: this is an at-most-once scheduled
 * action with no retrier behind it, and `makeGitlabRequester` does not swallow
 * a transport failure, so a dropped connection mid-drain throws straight out
 * and abandons the resync at that offset. Both that and the "no usable
 * credential" case are recorded through `core/forceResyncFailure`, so a GitHub
 * and a GitLab give-up read identically on `admin/jobs` — and neither is left
 * contradicted by the `integration.force_resync` audit entry that was written
 * before the drain started.
 */

interface GitlabIssueResponse {
  id: number;
  iid: number;
  state: string;
  title: string;
  description?: string | null;
  web_url: string;
  author: { username: string; avatar_url?: string; web_url?: string };
  labels?: string[];
  assignees?: {
    id: number;
    username: string;
    avatar_url?: string;
    web_url?: string;
  }[];
}

/** Issues processed per invocation — same bound as the GitHub action. */
const RESYNC_BATCH_SIZE = 25;

/** Fallback pause when a 429 carries no parseable `Retry-After`. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * A GitLab user's Ripple-facing identity. `web_url` is optional on some
 * payloads, so the canonical `<base>/<username>` profile form is synthesized —
 * matching `gitlab/webhook.gitlabAuthor`.
 */
function author(u: {
  username: string;
  avatar_url?: string;
  web_url?: string;
}) {
  return {
    login: u.username,
    avatarUrl: u.avatar_url ?? "",
    url: u.web_url ?? `https://gitlab.com/${u.username}`,
  };
}

export const runForceResync = internalAction({
  args: {
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    // Drain cursor into `getResyncContext().items`; omitted on the first
    // invocation (the `forceResync` mutation schedules without it).
    offset: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const offset = args.offset ?? 0;

    const context = await ctx.runQuery(
      internal.integrations.core.forceResyncQueries.getResyncContext,
      { projectIntegrationLinkId: args.projectIntegrationLinkId },
    );
    if (!context) return null;

    // `installationId` is GitLab's `credentialRef` (the integration's
    // externalAccountId); the token client refreshes an expiring OAuth bundle.
    const token = await getValidGitlabAccessToken(ctx, context.installationId);
    if (!token) {
      await recordForceResyncGaveUp(ctx, {
        provider: "gitlab",
        projectIntegrationLinkId: args.projectIntegrationLinkId,
        offset,
        reason: "no usable GitLab credential for this integration",
      });
      return null;
    }
    const gl = makeGitlabRequester(token);
    const project = encodeURIComponent(context.externalRepoId);

    try {
      const slice = context.items.slice(offset, offset + RESYNC_BATCH_SIZE);
      for (let i = 0; i < slice.length; i++) {
        const item = slice[i];
        const res = await gl.request<GitlabIssueResponse>({
          method: "GET",
          path: `/projects/${project}/issues/${item.issueNumber}`,
        });

        // Rate-limited: stop the batch and resume this same item after GitLab's
        // cool-off. Earlier items in the slice were already applied (the apply
        // step is idempotent), so resuming from the failing absolute index
        // neither double-applies nor skips.
        if (res.status === 429) {
          await ctx.scheduler.runAfter(
            res.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS,
            internal.integrations.gitlab.forceResyncAction.runForceResync,
            {
              projectIntegrationLinkId: args.projectIntegrationLinkId,
              offset: offset + i,
            },
          );
          return null;
        }

        if (res.status !== 200 || !res.body) {
          console.warn(
            `[gitlab/forceResync] issue fetch failed (status=${res.status}) for !${item.issueNumber}`,
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
              externalIssueId: String(issue.id),
              issueNumber: issue.iid,
              // GitLab's open state is spelled `opened`; anything else that isn't
              // `closed` (e.g. `locked`) is still an open issue.
              state: issue.state === "closed" ? "closed" : "open",
              // GitLab has no completed/not_planned distinction.
              stateReason: "completed",
              title: issue.title,
              body: issue.description ?? "",
              url: issue.web_url,
              externalAuthor: author(issue.author),
              labels: issue.labels ?? [],
              assignees: (issue.assignees ?? []).map((u) => ({
                ...author(u),
                // GitLab resolves the Ripple member by numeric id, not login.
                id: String(u.id),
              })),
            },
          },
        );
      }

      // More items remain → schedule the next batch from the new offset.
      if (offset + slice.length < context.items.length) {
        await ctx.scheduler.runAfter(
          0,
          internal.integrations.gitlab.forceResyncAction.runForceResync,
          {
            projectIntegrationLinkId: args.projectIntegrationLinkId,
            offset: offset + slice.length,
          },
        );
      }
      return null;
    } catch (error) {
      // Last line of defence for an at-most-once action. Recorded, then
      // rethrown: the throw is what marks the scheduled run failed, and the
      // operator row is what makes it findable afterwards.
      await recordForceResyncGaveUp(ctx, {
        provider: "gitlab",
        projectIntegrationLinkId: args.projectIntegrationLinkId,
        offset,
        reason: describeError(error),
      });
      throw error;
    }
  },
});
