import { ActionRetrier, type RunId } from "@convex-dev/action-retrier";
import { components, internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import {
  deriveDesiredExternalState,
  shouldSkipForEcho,
  shouldSkipForFreeze,
} from "./syncOut";

/**
 * Outbound dispatcher. Called by `tasks.update` and `tasks.updatePosition`
 * after a status change to push the change to GitHub (or any other future
 * provider) — but only when:
 *
 *  - The task has a `taskIntegrationLinks` row (it's actually linked).
 *  - The destination link is sync-active (freeze/pause guard).
 *  - The desired external state differs from the last-known
 *    `externalState` (echo guard).
 *
 * Each successful gate enqueues a retrier-managed action; the action body
 * does the HTTP call and records success/failure into the link row.
 */
const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 2_000,
  base: 2,
  maxFailures: 4,
});

export async function maybeEnqueueOutboundPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();
  if (!link) return; // Ripple-native task; nothing to push.

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  const status = await ctx.db.get(task.statusId);
  if (!status) return;

  const desired = deriveDesiredExternalState({ task, status });
  if (
    shouldSkipForEcho({ desired: desired.state, observed: link.externalState })
  ) {
    return;
  }

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  const runId = await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushIssueState,
    {
      taskId,
      desiredState: desired.state,
      desiredStateReason: desired.stateReason,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
      issueNumber: link.externalIssueId
        ? // The externalIssueId is a node id; the REST API needs the human
          // issue number, which we stored in `tasks.externalRefs[0]`.
          (task.externalRefs?.[0]?.issueNumber ?? 0)
        : 0,
    },
    {
      // Retry-exhaustion handling: the action body records its own outcome
      // for the 2xx and permanent-fail (4xx) cases, but a chain of throws
      // that exhausts the retry budget never reaches that recording path.
      // The callback closes that gap by writing `lastSyncError` + audit log.
      // Cast bridges the `RunId` brand which static codegen strips off the
      // generated function reference (the validator handles it at runtime).
      onComplete: internal.integrations.github.syncOutMutations
        .onOutboundComplete as unknown as FunctionReference<
        "mutation",
        "internal",
        {
          runId: RunId;
          result:
            | { type: "success"; returnValue: unknown }
            | { type: "failed"; error: string }
            | { type: "canceled" };
        }
      >,
    },
  );

  // Map runId → link so the onComplete callback can find this link from the
  // bare `{ runId, result }` payload action-retrier hands it.
  await ctx.db.patch(link._id, { outboundRunId: runId });
}
