import { v, type Infer } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import { getIntegrationForLink } from "../core/integrationLookups";
import { logTaskIntegrationActivity } from "../core/integrationActivity";
import { setTaskExternalLink } from "../core/taskExternalLink";
import { onCompleteValidator } from "@convex-dev/action-retrier";

/**
 * V8-isolate mutations invoked from the Node-only outbound action.
 * Co-located so future Phase 9 "Force resync" wiring drops in here too.
 */

/**
 * A successful task-keyed outbound op, discriminated by which field it mirrors.
 * The shared write path (`recordTaskOutboundResult`) does the `by_task` lookup
 * and the `lastSyncError` clear once; `mirrorFor` is the only per-op variation.
 */
const outboundResultValidator = v.union(
  v.object({ op: v.literal("labels"), nextLabels: v.array(v.string()) }),
  v.object({ op: v.literal("assignees"), nextLogins: v.array(v.string()) }),
  v.object({ op: v.literal("description") }),
  v.object({
    op: v.literal("state"),
    state: v.union(v.literal("open"), v.literal("closed")),
    stateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    // GitHub's authoritative `issue.updated_at` from the PATCH response, ms.
    externalUpdatedAt: v.number(),
  }),
);

export type OutboundResult = Infer<typeof outboundResultValidator>;

/**
 * The mirror patch a successful op writes onto the link. Pure and run *inside*
 * the mutation handler — so the state-reason `undefined` (which clears a stale
 * reason on reopen) survives, where a serialized `undefined` arg would not.
 *
 * Notes on what each op deliberately does NOT touch:
 *  - labels / assignees do not bump `externalUpdatedAt`: the inbound
 *    bounce-back is caught by the set-comparison echo guard (timestamp-
 *    independent), and bumping to wall-clock would risk dropping a genuine
 *    later change at the `isStale` gate under forward clock skew.
 *  - state records GitHub's own `updated_at` (not wall-clock) so the
 *    bounce-back compares EQUAL under `isStale` (`<=`) and drops.
 */
/**
 * Build the canonical web URL for a freshly-created issue, per provider. GitLab
 * nests issues under `/-/issues/`; GitHub uses `/issues/`. (gitlab.com host for
 * now — a self-hosted base URL would be threaded from the integration later.)
 */
function issueWebUrl(
  provider: string,
  repoFullName: string,
  issueNumber: number,
): string {
  return provider === "gitlab"
    ? `https://gitlab.com/${repoFullName}/-/issues/${issueNumber}`
    : `https://github.com/${repoFullName}/issues/${issueNumber}`;
}

export function mirrorFor(result: OutboundResult): Partial<Doc<"taskIntegrationLinks">> {
  switch (result.op) {
    case "labels":
      return { externalLabels: result.nextLabels };
    case "assignees":
      return { externalAssigneeLogins: result.nextLogins };
    case "description":
      return { descriptionLastSyncedAt: Date.now() };
    case "state":
      return {
        externalState: result.state,
        externalStateReason:
          result.state === "closed" ? result.stateReason ?? "completed" : undefined,
        externalUpdatedAt: result.externalUpdatedAt,
      };
  }
}

/**
 * Single write path for a successful task-keyed outbound op: resolve the link,
 * apply the op's mirror, and clear any prior `lastSyncError`. Replaces the four
 * near-identical `record*Success` mutations.
 */
export const recordTaskOutboundResult = internalMutation({
  args: { taskId: v.id("tasks"), result: outboundResultValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      ...mirrorFor(args.result),
      lastSyncError: undefined,
    });
    // Description push is the one outbound op with no inbound counterpart and no
    // other UI trace beyond the button's "Last synced" label, so surface it on
    // the task timeline. The other ops (labels/assignees/state) already mirror a
    // user edit that's logged locally, so logging them here would double up.
    if (args.result.op === "description") {
      await logTaskIntegrationActivity(ctx, {
        taskId: args.taskId,
        type: "description_synced",
      });
    }
    return null;
  },
});

/**
 * Shared write path for a permanent outbound failure: patches `lastSyncError`
 * onto the link and appends an `integration.sync_failed` audit-log entry
 * scoped to the workspace. Invoked from two callers:
 *
 *  1. The action body, on a classifier `permanent_fail` (4xx non-429 etc.).
 *  2. The retrier's `onComplete` callback, on retry exhaustion.
 */
async function recordOutboundFailureImpl(
  ctx: MutationCtx,
  args: { taskId: Id<"tasks">; message: string; httpStatus?: number },
): Promise<void> {
  const link = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
    .unique();
  if (!link) return;
  await ctx.db.patch(link._id, {
    lastSyncError: {
      occurredAt: Date.now(),
      message: args.message,
      httpStatus: args.httpStatus,
    },
  });

  // Surface permanent outbound failures in the workspace audit log so admins
  // can diagnose drift after the fact. Bot user is the closest stand-in for
  // a system actor; sync events have no human originator.
  const projectLink = await ctx.db.get(link.projectIntegrationLinkId);
  if (!projectLink) return;
  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_workspace", (q) =>
      q.eq("workspaceId", projectLink.workspaceId),
    )
    .unique();
  if (!integration) return;
  try {
    await auditLog.log(ctx, {
      action: "integration.sync_failed",
      actorId: integration.botUserId.toString(),
      resourceType: "tasks",
      resourceId: args.taskId,
      severity: "warning",
      metadata: {
        message: args.message,
        httpStatus: args.httpStatus,
      },
      scope: projectLink.workspaceId,
    });
  } catch (err) {
    console.error("[auditLog] failed to log integration.sync_failed", err);
  }
}

export const recordOutboundFailure = internalMutation({
  args: {
    taskId: v.id("tasks"),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordOutboundFailureImpl(ctx, args);
    return null;
  },
});

/**
 * Records a permanent failure of the "close the GitHub issue on task delete"
 * op. Unlike every other outbound failure, the task (and its
 * `taskIntegrationLinks` row) is already gone by the time this runs, so there's
 * no row to mark `lastSyncError` on — the only durable trace is a
 * workspace-scoped audit entry, which is also the only place an admin could see
 * that an explicit "close the issue too" request didn't land.
 */
export const recordIssueCloseFailure = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    issueNumber: v.number(),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (!integration) return null;
    try {
      await auditLog.log(ctx, {
        action: "integration.issue_close_failed",
        actorId: integration.botUserId.toString(),
        resourceType: "tasks",
        resourceId: `issue-${args.issueNumber}`,
        severity: "warning",
        metadata: {
          issueNumber: args.issueNumber,
          message: args.message,
          httpStatus: args.httpStatus,
        },
        scope: args.workspaceId,
      });
    } catch (err) {
      console.error(
        "[auditLog] failed to log integration.issue_close_failed",
        err,
      );
    }
    return null;
  },
});

/**
 * Records a successful "create GitHub issue from task" op: writes the
 * `taskIntegrationLinks` row (the task↔issue link that every later inbound and
 * outbound op keys on) and mirrors the issue number/url onto
 * `tasks.externalRefs` (where the outbound dispatchers read `issueNumber`).
 *
 * Idempotent against the bounce-back `issues.opened` webhook racing the
 * recorder: if a link already exists for this issue or task (the webhook beat
 * us, or a double-submit), this no-ops rather than creating a duplicate.
 */
export const recordIssueCreateSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    externalIssueId: v.string(),
    issueNumber: v.number(),
    externalUpdatedAt: v.number(),
    externalAuthor: v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;

    const projectLink = await ctx.db.get(args.projectIntegrationLinkId);
    if (!projectLink) return null;
    const integration = await getIntegrationForLink(ctx, projectLink);
    if (!integration) return null;

    // Echo-race guard: an inbound `issues.opened` for the issue we just created
    // may have landed first and built the link itself. Don't double-insert.
    const byIssue = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q
          .eq("projectIntegrationLinkId", args.projectIntegrationLinkId)
          .eq("externalIssueId", args.externalIssueId),
      )
      .unique();
    if (byIssue) return null;
    // Double-submit guard: the task already acquired a link some other way.
    const byTask = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (byTask) return null;

    await ctx.db.insert("taskIntegrationLinks", {
      taskId: args.taskId,
      projectIntegrationLinkId: args.projectIntegrationLinkId,
      externalIssueId: args.externalIssueId,
      externalUpdatedAt: args.externalUpdatedAt,
      externalAuthor: args.externalAuthor,
      externalState: "open",
    });

    await setTaskExternalLink(ctx, {
      taskId: args.taskId,
      projectId: task.projectId,
      ref: {
        provider: integration.provider,
        repoFullName: projectLink.externalRepoFullName,
        issueNumber: args.issueNumber,
        url: issueWebUrl(
          integration.provider,
          projectLink.externalRepoFullName,
          args.issueNumber,
        ),
      },
    });

    await logTaskIntegrationActivity(ctx, {
      taskId: args.taskId,
      type: "issue_created",
      newValue: `#${args.issueNumber}`,
    });
    return null;
  },
});

/**
 * Records a permanent failure of "create GitHub issue from task". There's no
 * link row yet (creation is what failed), so — like the issue-close failure —
 * the only durable trace is a workspace-scoped audit entry scoped to the task.
 */
export const recordIssueCreateFailure = internalMutation({
  args: {
    taskId: v.id("tasks"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const projectLink = await ctx.db.get(args.projectIntegrationLinkId);
    if (!projectLink) return null;
    const integration = await getIntegrationForLink(ctx, projectLink);
    if (!integration) return null;
    try {
      await auditLog.log(ctx, {
        action: "integration.issue_create_failed",
        actorId: integration.botUserId.toString(),
        resourceType: "tasks",
        resourceId: args.taskId,
        severity: "warning",
        metadata: { message: args.message, httpStatus: args.httpStatus },
        scope: projectLink.workspaceId,
      });
    } catch (err) {
      console.error(
        "[auditLog] failed to log integration.issue_create_failed",
        err,
      );
    }
    return null;
  },
});

export const recordCommentCreateSuccess = internalMutation({
  args: {
    commentId: v.id("taskComments"),
    taskIntegrationLinkId: v.id("taskIntegrationLinks"),
    externalCommentId: v.string(),
    externalUpdatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // No `externalAuthor`: this comment originated in Ripple and already has a
    // real `userId`/avatar. The GitHub API returns our App bot as the comment
    // author, but writing that here would make the `list` query render the bot
    // chip and override the human's avatar. The link row still exists so
    // inbound edit/delete echoes resolve by `externalCommentId`.
    await ctx.db.insert("taskCommentIntegrationLinks", {
      taskCommentId: args.commentId,
      taskIntegrationLinkId: args.taskIntegrationLinkId,
      externalCommentId: args.externalCommentId,
      externalUpdatedAt: args.externalUpdatedAt,
    });
    // Clear any prior failure marker so the UI's "⚠ Sync failed" affordance
    // goes away.
    await ctx.db.patch(args.commentId, { lastSyncError: undefined });
    return null;
  },
});

export const recordCommentCreateFailure = internalMutation({
  args: {
    commentId: v.id("taskComments"),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, {
      lastSyncError: {
        occurredAt: Date.now(),
        message: args.message,
        httpStatus: args.httpStatus,
      },
    });
    return null;
  },
});

export const recordCommentEditSuccess = internalMutation({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalUpdatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentLinkId, {
      externalUpdatedAt: args.externalUpdatedAt,
      lastSyncError: undefined,
    });
    return null;
  },
});

export const recordCommentDeleteSuccess = internalMutation({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentLinkId, { lastSyncError: undefined });
    return null;
  },
});

export const recordCommentLinkFailure = internalMutation({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    message: v.string(),
    httpStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentLinkId, {
      lastSyncError: {
        occurredAt: Date.now(),
        message: args.message,
        httpStatus: args.httpStatus,
      },
    });
    return null;
  },
});

/**
 * Retrier `onComplete` callback. The retrier only hands us `{ runId, result }`,
 * so we resolve the affected task via the `integrationOutboundRuns` side table
 * row that the dispatcher inserts at scheduling time.
 *
 *  - result.type === "success": the action recorded its own outcome already
 *    (success or `permanent_fail`). Just drop the tracking row.
 *  - result.type === "failed":  retry budget exhausted before the action
 *    returned cleanly. Record the failure here so the "⚠ Sync failed"
 *    affordance surfaces.
 *  - result.type === "canceled": same as success — just drop the row.
 */
export const onOutboundComplete = internalMutation({
  args: onCompleteValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("integrationOutboundRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .unique();
    if (!run) return null;
    await ctx.db.delete(run._id);

    if (args.result.type === "failed") {
      await recordOutboundFailureImpl(ctx, {
        taskId: run.taskId,
        message: `Outbound sync retries exhausted: ${args.result.error}`,
      });
    }
    return null;
  },
});
