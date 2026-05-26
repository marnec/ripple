import { ActionRetrier, type RunId } from "@convex-dev/action-retrier";
import { components, internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import { normalizeTagList } from "../../tagSync";
import { diffSet, normalizeLoginList } from "./syncableSet";
import { getWorkspaceIntegration } from "./integrationLookups";
import {
  deriveDesiredExternalState,
  shouldSkipForEcho,
  shouldSkipForFreeze,
} from "./syncOut";

/**
 * Outbound dispatchers. Called by `tasks.update`, `tasks.updatePosition`, and
 * the `taskComments.*` mutations after a change that may need pushing to GitHub
 * (or any future provider) — but only when:
 *
 *  - The task has a `taskIntegrationLinks` row (it's actually linked).
 *  - The destination link is sync-active (freeze/pause guard).
 *  - The desired external state differs from the last-known mirror (echo guard).
 *
 * Each surviving gate enqueues a retrier-managed action; the action body
 * (`github/syncOutAction.ts`) does the HTTP call and records success/failure
 * into the link row via the recorder mutations.
 */
const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 2_000,
  base: 2,
  maxFailures: 4,
});

/**
 * Retrier `onComplete` callback reference. The action body records its own
 * outcome for the 2xx and permanent-fail cases, but a throw-chain that
 * exhausts the retry budget never reaches that path — this callback closes
 * the gap by writing `lastSyncError` + an audit entry. The cast bridges the
 * `RunId` brand that static codegen strips off the generated reference (the
 * validator handles it at runtime). Shared by the two ops that schedule with
 * an `onComplete` (status + description).
 */
const ON_COMPLETE = internal.integrations.github.syncOutMutations
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
>;

/**
 * Routing + state for a task-keyed outbound push. `null` for every "skip
 * silently" case the dispatchers share: task gone, not linked (Ripple-native),
 * project link missing, frozen/paused, or no workspace integration row.
 *
 * The `issueNumber` comes from `tasks.externalRefs[0]` because the link stores
 * the stable node id (`externalIssueId`) while GitHub's REST API needs the
 * human issue number.
 */
interface OutboundTaskTarget {
  task: Doc<"tasks">;
  link: Doc<"taskIntegrationLinks">;
  projectLink: Doc<"projectIntegrationLinks">;
  installationId: string;
  repoFullName: string;
  issueNumber: number;
}

async function resolveTaskTarget(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<OutboundTaskTarget | null> {
  const task = await ctx.db.get(taskId);
  if (!task) return null;

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();
  if (!link) return null; // Ripple-native task; nothing to push.
  // Issue deleted upstream — the GitHub issue is gone, so any PATCH would 404.
  // Skip silently rather than spamming `lastSyncError` on every Ripple edit.
  if (link.externalDeletedAt !== undefined) return null;

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return null;
  if (shouldSkipForFreeze(projectLink)) return null;

  const integration = await getWorkspaceIntegration(
    ctx,
    projectLink.workspaceId,
  );
  if (!integration) return null;

  return {
    task,
    link,
    projectLink,
    installationId: integration.externalAccountId,
    repoFullName: projectLink.externalRepoFullName,
    issueNumber: task.externalRefs?.[0]?.issueNumber ?? 0,
  };
}

/** Routing for a comment-keyed push, resolved from the comment-link row. */
interface OutboundCommentTarget {
  commentLink: Doc<"taskCommentIntegrationLinks">;
  installationId: string;
  repoFullName: string;
}

async function resolveCommentLinkTarget(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<OutboundCommentTarget | null> {
  const commentLink = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_taskComment", (q) => q.eq("taskCommentId", commentId))
    .unique();
  if (!commentLink) return null; // create POST in flight / never ran / native.

  const taskLink = await ctx.db.get(commentLink.taskIntegrationLinkId);
  if (!taskLink) return null;
  if (taskLink.externalDeletedAt !== undefined) return null; // issue gone upstream
  const projectLink = await ctx.db.get(taskLink.projectIntegrationLinkId);
  if (!projectLink) return null;
  if (shouldSkipForFreeze(projectLink)) return null;

  const integration = await getWorkspaceIntegration(
    ctx,
    projectLink.workspaceId,
  );
  if (!integration) return null;

  return {
    commentLink,
    installationId: integration.externalAccountId,
    repoFullName: projectLink.externalRepoFullName,
  };
}

/**
 * Status push. Derives the desired open/closed state from `tasks.completed`
 * and the destination status's `externalCloseReason`, and skips when it
 * already matches the mirror (the dominant reason a status change produces no
 * HTTP call). Tracks the run in `integrationOutboundRuns` so retry-exhaustion
 * can be attributed back to the task via `onOutboundComplete`.
 */
export async function maybeEnqueueOutboundPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const target = await resolveTaskTarget(ctx, taskId);
  if (!target) return;

  const status = await ctx.db.get(target.task.statusId);
  if (!status) return;

  const desired = deriveDesiredExternalState({ task: target.task, status });
  if (
    shouldSkipForEcho({
      desired: desired.state,
      observed: target.link.externalState,
    })
  ) {
    return;
  }

  const runId = await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushIssueState,
    {
      taskId,
      desiredState: desired.state,
      desiredStateReason: desired.stateReason,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
    },
    { onComplete: ON_COMPLETE },
  );

  // Map runId → task so the onComplete callback can resolve this push from the
  // bare `{ runId, result }` payload. A side-table row (rather than a field on
  // the link) keeps concurrent pushes — e.g. a status flip and a description
  // push racing within the retry window — from clobbering each other's runId
  // and losing a retry-exhaustion failure.
  await ctx.db.insert("integrationOutboundRuns", { runId, taskId });
}

/**
 * Description push. Called by the public `tasks.syncDescriptionToGitHub`
 * mutation with the client-rendered markdown. Unlike the other pushers this is
 * user-initiated (a button click), so it throws on a missing link/integration
 * to surface the error rather than silently no-opping — and it has no echo
 * guard (identical re-pushes are harmless GitHub no-ops).
 */
export async function enqueueDescriptionPush(
  ctx: MutationCtx,
  args: { taskId: Id<"tasks">; markdown: string },
): Promise<void> {
  const task = await ctx.db.get(args.taskId);
  if (!task) throw new Error("Task not found");

  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .unique();
  if (!link) throw new Error("Task is not linked to a GitHub issue");
  if (link.externalDeletedAt !== undefined) return; // issue gone upstream — no-op

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) throw new Error("Project integration link missing");
  if (shouldSkipForFreeze(projectLink)) return; // silently no-op while frozen

  const integration = await getWorkspaceIntegration(
    ctx,
    projectLink.workspaceId,
  );
  if (!integration) throw new Error("Workspace integration row missing");

  const issueNumber = task.externalRefs?.[0]?.issueNumber ?? 0;
  if (!issueNumber) throw new Error("Task has no GitHub issue number");

  const runId = await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushDescription,
    {
      taskId: args.taskId,
      markdown: args.markdown,
      installationId: integration.externalAccountId,
      repoFullName: projectLink.externalRepoFullName,
      issueNumber,
    },
    { onComplete: ON_COMPLETE },
  );

  await ctx.db.insert("integrationOutboundRuns", {
    runId,
    taskId: args.taskId,
  });
}

/**
 * Label push. Diffs the post-patch label set against the link's
 * `externalLabels` mirror and enqueues a single action that POSTs the adds and
 * DELETEs the removes. The action records the final set as the new mirror so
 * the inbound echo guard catches GitHub's bounce-back webhook.
 */
export async function maybeEnqueueLabelsPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const target = await resolveTaskTarget(ctx, taskId);
  if (!target) return;

  const nextLabels = normalizeTagList(target.task.labels ?? []);
  const { add, remove, changed } = diffSet(
    nextLabels,
    target.link.externalLabels ?? [],
  );

  // Echo guard: no diff, no PATCH.
  if (!changed) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushLabelChanges,
    {
      taskId,
      add,
      remove,
      nextLabels,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
    },
  );
}

/**
 * Assignee push. Resolves the post-patch Ripple assignee to a single GitHub
 * login via `workspaceMemberExternalIdentity` (skipping the bot user and
 * unmapped members — they have no login to push), diffs against
 * `externalAssigneeLogins`, and enqueues an action when there's work.
 *
 * Ripple→GitHub is intentionally 1→1: a cleared assignee DELETEs whatever
 * GitHub knows, but an assignee with no mapped identity (bot user, or a member
 * who hasn't linked their GitHub account) skips entirely so we don't erase the
 * real external assignees rendered as shadow chips.
 */
export async function maybeEnqueueAssigneesPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const target = await resolveTaskTarget(ctx, taskId);
  if (!target) return;
  const { task, projectLink } = target;

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
    nextLogins = normalizeLoginList([identity.externalLogin]);
  }

  const { add, remove, changed } = diffSet(
    nextLogins,
    target.link.externalAssigneeLogins ?? [],
  );

  // Echo guard: no diff, no PATCH.
  if (!changed) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushAssigneeChanges,
    {
      taskId,
      add,
      remove,
      nextLogins,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
    },
  );
}

/**
 * Comment-create push. The action POSTs to GitHub and (on success) writes a
 * `taskCommentIntegrationLinks` row carrying the returned comment id; failures
 * land on `taskComments.lastSyncError` (no link row yet).
 */
export async function maybeEnqueueCommentCreate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const target = await resolveTaskTarget(ctx, comment.taskId);
  if (!target) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentCreate,
    {
      commentId,
      body: comment.body,
      taskIntegrationLinkId: target.link._id,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
    },
  );
}

/**
 * Comment-update push. Skipped when no comment-link row exists yet (the create
 * POST is still in flight, never ran, or the comment is Ripple-native).
 */
export async function maybeEnqueueCommentUpdate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const target = await resolveCommentLinkTarget(ctx, commentId);
  if (!target) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentEdit,
    {
      commentLinkId: target.commentLink._id,
      externalCommentId: target.commentLink.externalCommentId,
      body: comment.body,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
    },
  );
}

/**
 * Issue-close push. Closes the linked GitHub issue (state=closed,
 * reason=completed) when the user opts in while deleting the task. GitHub App
 * installation tokens can't *delete* issues — there's no such permission — so
 * "delete the issue too" is realized as a close, which the `Issues: write`
 * grant fully supports.
 *
 * MUST be called *before* the task's cascade delete runs — it reads the
 * `taskIntegrationLinks` row to capture the repo and installation, which the
 * cascade then removes. Skips silently for an unlinked task or a frozen/paused
 * integration (a frozen link means "don't touch GitHub").
 *
 * Unlike the other task pushes this schedules *without* an `onComplete`
 * callback or an `integrationOutboundRuns` row: those resolve the affected task
 * to write `lastSyncError`, but here the task is about to be gone. Retryable
 * failures still retry; a permanent failure is recorded in the workspace audit
 * log by the action's sink.
 */
export async function enqueueIssueClose(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const target = await resolveTaskTarget(ctx, taskId);
  if (!target) return;
  if (!target.issueNumber) return; // no issue number → nothing to close

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushIssueClose,
    {
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
      workspaceId: target.projectLink.workspaceId,
      installationId: target.installationId,
    },
  );
}

/** Comment-delete push. Skipped when no comment-link row exists. */
export async function maybeEnqueueCommentDelete(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const target = await resolveCommentLinkTarget(ctx, commentId);
  if (!target) return;

  await retrier.run(
    ctx,
    internal.integrations.github.syncOutAction.pushCommentDelete,
    {
      commentLinkId: target.commentLink._id,
      externalCommentId: target.commentLink.externalCommentId,
      installationId: target.installationId,
      repoFullName: target.repoFullName,
    },
  );
}
