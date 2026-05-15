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
