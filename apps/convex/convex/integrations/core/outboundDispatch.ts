import { ActionRetrier } from "@convex-dev/action-retrier";
import { components } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { normalizeTagList } from "../../tagSync";
import { diffSet, normalizeLoginList } from "./syncableSet";
import { memberToExternalLogin, memberToExternalUserId } from "./identity";
import { getIntegrationForLink } from "./integrationLookups";
import { resolveOutboundAdapter, type OutboundAdapter } from "./outboundAdapters";
import {
  deriveDesiredExternalState,
  shouldSkipForEcho,
  shouldSkipForFreeze,
} from "./syncOut";
import { appendRippleTaskMarker } from "./rippleMarker";

/**
 * Outbound dispatchers. Called by `tasks.update`, `tasks.updatePosition`, and
 * the `taskComments.*` mutations after a change that may need pushing to the
 * linked provider — but only when:
 *
 *  - The task has a `taskIntegrationLinks` row (it's actually linked).
 *  - The destination link is sync-active (freeze/pause guard).
 *  - The desired external state differs from the last-known mirror (echo guard).
 *  - The link's provider has a registered outbound adapter (seam 1) — otherwise
 *    we refuse to push rather than defaulting to GitHub.
 *
 * Each surviving gate enqueues a retrier-managed action resolved from the
 * provider's adapter (`core/outboundAdapters.ts`); the action body
 * (`<provider>/syncOutAction.ts`) does the HTTP call and records success/failure
 * into the link row via the recorder mutations. Args are the provider-neutral
 * contract: an opaque `credentialRef` (seam 2) and `projectRef`/`issueRef`
 * addressing (seam 4).
 */
const retrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 2_000,
  base: 2,
  maxFailures: 4,
});

/**
 * Routing + state for a task-keyed outbound push. `null` for every "skip
 * silently" case the dispatchers share: task gone, not linked (Ripple-native),
 * project link missing, frozen/paused, no workspace integration row, or no
 * registered outbound adapter for the link's provider.
 *
 * The `issueRef` comes from `tasks.externalRefs[0]` because the link stores the
 * stable id (`externalIssueId`) while the provider's REST API needs the human
 * issue number. `credentialRef`/`projectRef` are the neutral outbound contract
 * (for GitHub: the installation id + `owner/repo`).
 */
interface OutboundTaskTarget {
  task: Doc<"tasks">;
  link: Doc<"taskIntegrationLinks">;
  projectLink: Doc<"projectIntegrationLinks">;
  adapter: OutboundAdapter;
  provider: string;
  credentialRef: string;
  projectRef: string;
  issueRef: number;
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
  // Issue deleted upstream — the provider's issue is gone, so any PATCH would
  // 404. Skip silently rather than spamming `lastSyncError` on every edit.
  if (link.externalDeletedAt !== undefined) return null;

  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return null;
  if (shouldSkipForFreeze(projectLink)) return null;

  const integration = await getIntegrationForLink(ctx, projectLink);
  if (!integration) return null;

  // Seam 1: route by provider. No adapter → refuse to push (never fall back to
  // GitHub for a non-GitHub link).
  const adapter = resolveOutboundAdapter(integration.provider);
  if (!adapter) return null;

  return {
    task,
    link,
    projectLink,
    adapter,
    provider: integration.provider,
    credentialRef: integration.externalAccountId,
    projectRef: projectLink.externalRepoFullName,
    issueRef: task.externalRefs?.[0]?.issueNumber ?? 0,
  };
}

/** Routing for a comment-keyed push, resolved from the comment-link row. */
interface OutboundCommentTarget {
  commentLink: Doc<"taskCommentIntegrationLinks">;
  adapter: OutboundAdapter;
  credentialRef: string;
  projectRef: string;
  issueRef: number;
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

  const integration = await getIntegrationForLink(ctx, projectLink);
  if (!integration) return null;

  const adapter = resolveOutboundAdapter(integration.provider);
  if (!adapter) return null;

  // Human issue ref the comment hangs off — GitLab needs it to address a note
  // (GitHub edits/deletes a comment by id alone). Resolved from the task.
  const task = await ctx.db.get(taskLink.taskId);

  return {
    commentLink,
    adapter,
    credentialRef: integration.externalAccountId,
    projectRef: projectLink.externalRepoFullName,
    issueRef: task?.externalRefs?.[0]?.issueNumber ?? 0,
  };
}

/**
 * Issue-create push (task → new provider issue). User-initiated, so it throws on
 * a bad request rather than silently no-opping. Guards: the task must exist,
 * be uncompleted, and not already be linked; the chosen repo link must belong
 * to the task's project and be sync-active. The action POSTs the issue and (on
 * success) writes the task↔issue link + mirrors the ref onto the task.
 *
 * Like `enqueueIssueClose`, this schedules without an `onComplete` /
 * `integrationOutboundRuns` row: there's no link yet to carry a
 * `lastSyncError`, so a permanent failure is recorded only in the workspace
 * audit log by the action's sink.
 */
export async function enqueueIssueCreate(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectIntegrationLinkId: Id<"projectIntegrationLinks">;
    title: string;
    body: string;
  },
): Promise<void> {
  const task = await ctx.db.get(args.taskId);
  if (!task) throw new Error("Task not found");
  if (task.completed) {
    throw new Error("Cannot create a GitHub issue for a completed task");
  }

  const existing = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .unique();
  if (existing) throw new Error("Task is already linked to a GitHub issue");

  const projectLink = await ctx.db.get(args.projectIntegrationLinkId);
  if (!projectLink) throw new Error("Repository link not found");
  if (projectLink.projectId !== task.projectId) {
    throw new Error("Repository is not connected to this task's project");
  }
  if (projectLink.status !== "active") {
    throw new Error("Repository sync is not active");
  }
  if (shouldSkipForFreeze(projectLink)) {
    throw new Error("GitHub integration is frozen for this workspace");
  }

  const integration = await getIntegrationForLink(ctx, projectLink);
  if (!integration) throw new Error("Workspace integration row missing");
  const adapter = resolveOutboundAdapter(integration.provider);
  if (!adapter) {
    throw new Error(
      `No outbound adapter registered for provider "${integration.provider}"`,
    );
  }

  // Tag the body with the originating task id (invisible HTML comment) so
  // the inbound webhook can recognize the bounce-back of THIS create and
  // claim the link by taskId — independent of who authored it on the
  // provider side. Required for OAuth-impersonating installs (GitLab),
  // where the bot login collides with the human user. Belt-and-suspenders
  // for GitHub Apps too.
  const taggedBody = appendRippleTaskMarker(args.body, args.taskId);

  await retrier.run(ctx, adapter.ops.createIssue, {
    taskId: args.taskId,
    projectIntegrationLinkId: args.projectIntegrationLinkId,
    title: args.title,
    body: taggedBody,
    credentialRef: integration.externalAccountId,
    projectRef: projectLink.externalRepoFullName,
  });
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
    target.adapter.ops.issueState,
    {
      taskId,
      desiredState: desired.state,
      desiredStateReason: desired.stateReason,
      credentialRef: target.credentialRef,
      projectRef: target.projectRef,
      issueRef: target.issueRef,
    },
    { onComplete: target.adapter.onComplete },
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
 * guard (identical re-pushes are harmless provider no-ops).
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

  const integration = await getIntegrationForLink(ctx, projectLink);
  if (!integration) throw new Error("Workspace integration row missing");
  const adapter = resolveOutboundAdapter(integration.provider);
  if (!adapter) {
    throw new Error(
      `No outbound adapter registered for provider "${integration.provider}"`,
    );
  }

  const issueRef = task.externalRefs?.[0]?.issueNumber ?? 0;
  if (!issueRef) throw new Error("Task has no GitHub issue number");

  const runId = await retrier.run(
    ctx,
    adapter.ops.description,
    {
      taskId: args.taskId,
      markdown: args.markdown,
      credentialRef: integration.externalAccountId,
      projectRef: projectLink.externalRepoFullName,
      issueRef,
    },
    { onComplete: adapter.onComplete },
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
 * the inbound echo guard catches the provider's bounce-back webhook.
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

  await retrier.run(ctx, target.adapter.ops.labels, {
    taskId,
    add,
    remove,
    nextLabels,
    credentialRef: target.credentialRef,
    projectRef: target.projectRef,
    issueRef: target.issueRef,
  });
}

/**
 * Assignee push. Resolves the post-patch Ripple assignee to a single provider
 * login via `workspaceMemberExternalIdentity` (skipping the bot user and
 * unmapped members — they have no login to push), diffs against
 * `externalAssigneeLogins`, and enqueues an action when there's work.
 *
 * Ripple→provider is intentionally 1→1: a cleared assignee DELETEs whatever the
 * provider knows, but an assignee with no mapped identity (bot user, or a member
 * who hasn't linked their account) skips entirely so we don't erase the real
 * external assignees rendered as shadow chips.
 */
export async function maybeEnqueueAssigneesPush(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
): Promise<void> {
  const target = await resolveTaskTarget(ctx, taskId);
  if (!target) return;
  const { task, projectLink, provider } = target;

  // GitHub assigns by login; GitLab by numeric user id. Resolve the Ripple
  // assignee to whichever ref this provider needs (the mirror set + gateway
  // both speak the same provider-native ref).
  let nextLogins: string[] = [];
  if (task.assigneeId) {
    const ref =
      provider === "gitlab"
        ? await memberToExternalUserId(
            ctx,
            projectLink.workspaceId,
            task.assigneeId,
            provider,
          )
        : await memberToExternalLogin(
            ctx,
            projectLink.workspaceId,
            task.assigneeId,
            provider,
          );
    if (!ref) return; // unmappable assignee — preserve provider state.
    nextLogins = normalizeLoginList([ref]);
  }

  const { add, remove, changed } = diffSet(
    nextLogins,
    target.link.externalAssigneeLogins ?? [],
  );

  // Echo guard: no diff, no PATCH.
  if (!changed) return;

  await retrier.run(ctx, target.adapter.ops.assignees, {
    taskId,
    add,
    remove,
    nextLogins,
    credentialRef: target.credentialRef,
    projectRef: target.projectRef,
    issueRef: target.issueRef,
  });
}

/**
 * Comment-create push. The action POSTs to the provider and (on success) writes
 * a `taskCommentIntegrationLinks` row carrying the returned comment id; failures
 * land on `taskComments.lastSyncError` (no link row yet).
 *
 * `bodyMarkdown` is the client-rendered markdown of the comment (the stored
 * `taskComments.body` is BlockNote JSON, which the provider would render as
 * literal text). The conversion is lossy and done client-side for the same
 * reasons as the description push.
 */
export async function maybeEnqueueCommentCreate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
  bodyMarkdown: string,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const target = await resolveTaskTarget(ctx, comment.taskId);
  if (!target) return;

  await retrier.run(ctx, target.adapter.ops.commentCreate, {
    commentId,
    body: bodyMarkdown,
    taskIntegrationLinkId: target.link._id,
    credentialRef: target.credentialRef,
    projectRef: target.projectRef,
    issueRef: target.issueRef,
  });
}

/**
 * Comment-update push. Skipped when no comment-link row exists yet (the create
 * POST is still in flight, never ran, or the comment is Ripple-native).
 * `bodyMarkdown` carries the markdown rendering — see `maybeEnqueueCommentCreate`.
 */
export async function maybeEnqueueCommentUpdate(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
  bodyMarkdown: string,
): Promise<void> {
  const comment = await ctx.db.get(commentId);
  if (!comment) return;

  const target = await resolveCommentLinkTarget(ctx, commentId);
  if (!target) return;

  await retrier.run(ctx, target.adapter.ops.commentEdit, {
    commentLinkId: target.commentLink._id,
    externalCommentId: target.commentLink.externalCommentId,
    body: bodyMarkdown,
    credentialRef: target.credentialRef,
    projectRef: target.projectRef,
    issueRef: target.issueRef,
  });
}

/**
 * Issue-close push. Closes the linked provider issue (state=closed,
 * reason=completed) when the user opts in while deleting the task. GitHub App
 * installation tokens can't *delete* issues — there's no such permission — so
 * "delete the issue too" is realized as a close, which the `Issues: write`
 * grant fully supports.
 *
 * MUST be called *before* the task's cascade delete runs — it reads the
 * `taskIntegrationLinks` row to capture the repo and credential, which the
 * cascade then removes. Skips silently for an unlinked task or a frozen/paused
 * integration (a frozen link means "don't touch the provider").
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
  if (!target.issueRef) return; // no issue number → nothing to close

  await retrier.run(ctx, target.adapter.ops.issueClose, {
    projectRef: target.projectRef,
    issueRef: target.issueRef,
    workspaceId: target.projectLink.workspaceId,
    credentialRef: target.credentialRef,
  });
}

/** Comment-delete push. Skipped when no comment-link row exists. */
export async function maybeEnqueueCommentDelete(
  ctx: MutationCtx,
  commentId: Id<"taskComments">,
): Promise<void> {
  const target = await resolveCommentLinkTarget(ctx, commentId);
  if (!target) return;

  await retrier.run(ctx, target.adapter.ops.commentDelete, {
    commentLinkId: target.commentLink._id,
    externalCommentId: target.commentLink.externalCommentId,
    credentialRef: target.credentialRef,
    projectRef: target.projectRef,
    issueRef: target.issueRef,
  });
}
