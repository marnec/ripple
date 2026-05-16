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

export const recordOutboundSuccess = internalMutation({
  args: {
    taskId: v.id("tasks"),
    newExternalState: v.union(v.literal("open"), v.literal("closed")),
    newExternalStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
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
      externalUpdatedAt: Date.now(),
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
 * Retrier `onComplete` callback. The retrier only hands us `runId + result`
 * — we map back to the affected link via the `by_outboundRunId` index that
 * `maybeEnqueueOutboundPush` patches at scheduling time.
 *
 *  - result.type === "success": the action recorded its own outcome already
 *    (success or `permanent_fail`). Just clear the in-flight marker.
 *  - result.type === "failed":  retry budget exhausted before the action
 *    returned cleanly. Record the failure here so the "⚠ Sync failed"
 *    affordance surfaces.
 *  - result.type === "canceled": same as success — just clear.
 */
export const onOutboundComplete = internalMutation({
  args: onCompleteValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_outboundRunId", (q) =>
        q.eq("outboundRunId", args.runId),
      )
      .unique();
    if (!link) return null;
    await ctx.db.patch(link._id, { outboundRunId: undefined });

    if (args.result.type === "failed") {
      await recordOutboundFailureImpl(ctx, {
        taskId: link.taskId,
        message: `Outbound sync retries exhausted: ${args.result.error}`,
      });
    }
    return null;
  },
});
