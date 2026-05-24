import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { auditLog } from "../../auditLog";
import { onCompleteValidator } from "@convex-dev/action-retrier";

/**
 * V8-isolate mutations invoked from the Node-only outbound action.
 * Co-located so future Phase 9 "Force resync" wiring drops in here too.
 */

export const recordLabelsSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    nextLabels: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      externalLabels: args.nextLabels,
      // No `externalUpdatedAt` bump: the inbound bounce-back of these label
      // changes is caught by the set-comparison echo guard (`sameLabelSet`
      // against `externalLabels`), which is timestamp-independent. Bumping to
      // `Date.now()` here would instead risk dropping a genuine later label
      // change at the `isStale` gate if Convex's clock ran ahead of GitHub's.
      lastSyncError: undefined,
    });
    return null;
  },
});

export const recordAssigneesSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    nextLogins: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      externalAssigneeLogins: args.nextLogins,
      // No `externalUpdatedAt` bump: the inbound bounce-back (issues.assigned/
      // unassigned) is caught by the set-comparison echo guard (`sameLabelSet`
      // against `externalAssigneeLogins`), which is timestamp-independent.
      // Bumping to `Date.now()` would risk dropping a genuine later assignee
      // change at the `isStale` gate under forward clock skew.
      lastSyncError: undefined,
    });
    return null;
  },
});

export const recordDescriptionPushSuccess = internalMutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      descriptionLastSyncedAt: Date.now(),
      lastSyncError: undefined,
    });
    return null;
  },
});

export const recordOutboundSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    newExternalState: v.union(v.literal("open"), v.literal("closed")),
    newExternalStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    // GitHub's authoritative `issue.updated_at` from the PATCH response,
    // parsed to ms. Recording GitHub's own timestamp (not `Date.now()`) makes
    // the bounce-back webhook for this same change compare EQUAL under the
    // inbound `isStale` guard (`<=`) and drop, while a genuine later GitHub
    // edit carries a strictly-greater timestamp and applies — eliminating the
    // clock-skew window that `Date.now()` opened (a Convex clock running ahead
    // of GitHub's could otherwise drop a real subsequent event as "stale").
    externalUpdatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, {
      externalState: args.newExternalState,
      externalStateReason: args.newExternalStateReason,
      externalUpdatedAt: args.externalUpdatedAt,
      lastSyncError: undefined,
    });
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

export const recordCommentCreateSuccess = internalMutation({
  args: {
    commentId: v.id("taskComments"),
    taskIntegrationLinkId: v.id("taskIntegrationLinks"),
    externalCommentId: v.string(),
    externalUpdatedAt: v.number(),
    externalAuthor: v.object({
      login: v.string(),
      avatarUrl: v.string(),
      url: v.string(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("taskCommentIntegrationLinks", {
      taskCommentId: args.commentId,
      taskIntegrationLinkId: args.taskIntegrationLinkId,
      externalCommentId: args.externalCommentId,
      externalUpdatedAt: args.externalUpdatedAt,
      externalAuthor: args.externalAuthor,
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
