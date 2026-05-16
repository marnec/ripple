import { ActionRetrier, type RunId } from "@convex-dev/action-retrier";
import { components, internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import { normalizeTagList } from "../../tagSync";
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

/**
 * Outbound label dispatcher. Called by `tasks.update` whenever the `labels`
 * arg is present, after `syncTaskTags` reconciles the post-patch label set.
 * Computes the (add, remove) diff against the link's `externalLabels` mirror
 * and enqueues a single retrier-managed action that POSTs the adds and
 * DELETEs the removes. The action records the final label set as the new
 * `externalLabels` on success so subsequent webhook bounce-backs are
 * caught by the inbound echo guard.
 */
export async function maybeEnqueueLabelsPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();
  if (!link) return;

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  const nextLabels = normalizeTagList(task.labels ?? []);
  const prevLabels = link.externalLabels ?? [];
  const prevSet = new Set(prevLabels);
  const nextSet = new Set(nextLabels);
  const add = nextLabels.filter((l) => !prevSet.has(l));
  const remove = prevLabels.filter((l) => !nextSet.has(l));

  // Echo guard: no diff, no PATCH.
  if (add.length === 0 && remove.length === 0) return;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushLabelChanges,
    {
      taskId,
      add,
      remove,
      nextLabels,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
      issueNumber: task.externalRefs?.[0]?.issueNumber ?? 0,
    },
  );
}

/**
 * Outbound assignee dispatcher. Called by `tasks.update` whenever `assigneeId`
 * is part of the patch. Resolves the post-patch Ripple assignee to a GitHub
 * login via `workspaceMemberExternalIdentity` (skipping the bot user and
 * unmapped members — they have no login to push), diffs the resulting
 * one-element-or-empty set against `externalAssigneeLogins`, and enqueues a
 * single retrier-managed action when there's work to do.
 *
 * Ripple→GitHub is intentionally 1→1 even though GitHub supports multiple
 * assignees: Ripple models a single primary owner per task. The shadow-chip
 * GitHub assignees from inbound are display-only and never round-trip back.
 */
export async function maybeEnqueueAssigneesPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) return;

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();
  if (!link) return;

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  // Resolve the post-patch Ripple assignee → a single GitHub login. The
  // unmappable cases split two ways:
  //
  //  - `assigneeId === undefined` (cleared): nextLogins = []. We then push a
  //    diff that DELETEs whatever logins GitHub knows about.
  //  - `assigneeId` set but no mapped identity (bot user, or a member who
  //    hasn't linked their GitHub account): skip outbound entirely. Pushing
  //    a clear would erase the real external assignees we're rendering as
  //    shadow chips — but we also have nothing meaningful to push.
  let nextLogins: string[] = [];
  if (task.assigneeId) {
    const identity = await ctx.db
      .query("workspaceMemberExternalIdentity")
      .withIndex("by_workspace_user_provider", (q) =>
        q
          .eq("workspaceId", projectLink.workspaceId)
          .eq("userId", task.assigneeId!)
          .eq("provider", "github"),
      )
      .unique();
    if (!identity) return; // unmappable assignee — preserve GitHub state.
    nextLogins = [identity.externalLogin];
  }

  const prevLogins = link.externalAssigneeLogins ?? [];
  const prevSet = new Set(prevLogins);
  const nextSet = new Set(nextLogins);
  const add = nextLogins.filter((l) => !prevSet.has(l));
  const remove = prevLogins.filter((l) => !nextSet.has(l));

  // Echo guard: no diff, no PATCH.
  if (add.length === 0 && remove.length === 0) return;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushAssigneeChanges,
    {
      taskId,
      add,
      remove,
      nextLogins,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
      issueNumber: task.externalRefs?.[0]?.issueNumber ?? 0,
    },
  );
}

/**
 * Outbound comment create dispatcher. Called by `taskComments.create` after
 * the Ripple-side row is inserted. Gated by the same task-link + freeze
 * checks as the other comment/task pushers; skipped silently when:
 *
 *  - The parent task has no `taskIntegrationLinks` row (Ripple-native task).
 *  - The project link is paused or entitlement-frozen.
 *
 * The push action POSTs to GitHub and (on success) writes a
 * `taskCommentIntegrationLinks` row carrying the returned GitHub comment id.
 * Failures land on `taskComments.lastSyncError` (no link row yet).
 */
export async function maybeEnqueueCommentCreate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", comment.taskId))
    .unique();
  if (!link) return; // Ripple-native task.

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  const task = await ctx.db.get(comment.taskId);
  if (!task) return;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentCreate,
    {
      commentId,
      body: comment.body,
      taskIntegrationLinkId: link._id,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
      issueNumber: task.externalRefs?.[0]?.issueNumber ?? 0,
    },
  );
}

/**
 * Outbound comment update dispatcher. Skipped when no comment-link row
 * exists yet (the create POST is still in flight, never ran, or the
 * comment is Ripple-native on an unlinked task).
 */
export async function maybeEnqueueCommentUpdate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const commentLink = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId))
    .unique();
  if (!commentLink) return;

  const taskLink = await ctx.db.get(commentLink.taskIntegrationLinkId);
  if (!taskLink) return;
  const projectLink = await ctx.db.get(taskLink.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentEdit,
    {
      commentLinkId: commentLink._id,
      externalCommentId: commentLink.externalCommentId,
      body: comment.body,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
    },
  );
}

/**
 * Outbound comment delete dispatcher. Skipped when no comment-link row
 * exists (nothing to delete on the GitHub side).
 */
export async function maybeEnqueueCommentDelete(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const commentLink = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId))
    .unique();
  if (!commentLink) return;

  const taskLink = await ctx.db.get(commentLink.taskIntegrationLinkId);
  if (!taskLink) return;
  const projectLink = await ctx.db.get(taskLink.projectIntegrationLinkId);
  if (!projectLink) return;
  if (shouldSkipForFreeze(projectLink)) return;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentDelete,
    {
      commentLinkId: commentLink._id,
      externalCommentId: commentLink.externalCommentId,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
    },
  );
}
