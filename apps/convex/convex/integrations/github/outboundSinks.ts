import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { OutboundRecorderSink } from "../core/outboundRecorderSink";

/**
 * Concrete `OutboundRecorderSink`s for each outbound op. Each closes over an
 * `ActionCtx` plus the static args its recorder mutation needs, and pulls the
 * dynamic fields (provider `updated_at`, comment id, author) out of the
 * success `meta`. This is the single place `ctx.runMutation(internal.…)` is
 * called from the outbound actions — the recorder choice and the row-keying
 * (taskId vs commentId vs commentLinkId) are the per-op specialization that
 * the static-codegen `FunctionReference` constraint forces to live here rather
 * than be passed generically through the orchestrator.
 *
 * The recorder `internalMutation`s themselves (in `syncOutMutations.ts`) are
 * unchanged; only their call sites collapse behind these builders.
 */

/** Shared task-keyed permanent-failure path (status/description/labels/assignees). */
function taskFailure(ctx: ActionCtx, taskId: Id<"tasks">) {
  return async (message: string, httpStatus?: number): Promise<void> => {
    await ctx.runMutation(
      internal.integrations.github.syncOutMutations.recordOutboundFailure,
      { taskId, message, httpStatus },
    );
  };
}

export function taskStateSink(
  ctx: ActionCtx,
  args: {
    taskId: Id<"tasks">;
    state: "open" | "closed";
    stateReason?: "completed" | "not_planned";
  },
): OutboundRecorderSink {
  return {
    recordSuccess: async (meta) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordTaskOutboundResult,
        {
          taskId: args.taskId,
          result: {
            op: "state",
            state: args.state,
            stateReason: args.stateReason,
            // Fall back to wall-clock only if the provider omitted updated_at
            // (it shouldn't on a 2xx PATCH).
            externalUpdatedAt: meta.externalUpdatedAt ?? Date.now(),
          },
        },
      );
    },
    recordPermanentFailure: taskFailure(ctx, args.taskId),
  };
}

export function taskDescriptionSink(
  ctx: ActionCtx,
  taskId: Id<"tasks">,
): OutboundRecorderSink {
  return {
    recordSuccess: async () => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordTaskOutboundResult,
        { taskId, result: { op: "description" } },
      );
    },
    recordPermanentFailure: taskFailure(ctx, taskId),
  };
}

export function taskLabelsSink(
  ctx: ActionCtx,
  args: { taskId: Id<"tasks">; nextLabels: string[] },
): OutboundRecorderSink {
  return {
    recordSuccess: async () => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordTaskOutboundResult,
        { taskId: args.taskId, result: { op: "labels", nextLabels: args.nextLabels } },
      );
    },
    recordPermanentFailure: taskFailure(ctx, args.taskId),
  };
}

export function taskAssigneesSink(
  ctx: ActionCtx,
  args: { taskId: Id<"tasks">; nextLogins: string[] },
): OutboundRecorderSink {
  return {
    recordSuccess: async () => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordTaskOutboundResult,
        { taskId: args.taskId, result: { op: "assignees", nextLogins: args.nextLogins } },
      );
    },
    recordPermanentFailure: taskFailure(ctx, args.taskId),
  };
}

export function commentCreateSink(
  ctx: ActionCtx,
  args: {
    commentId: Id<"taskComments">;
    taskIntegrationLinkId: Id<"taskIntegrationLinks">;
  },
): OutboundRecorderSink {
  return {
    recordSuccess: async (meta) => {
      // The gateway only returns success for create with a full body, so these
      // fields are present.
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentCreateSuccess,
        {
          commentId: args.commentId,
          taskIntegrationLinkId: args.taskIntegrationLinkId,
          externalCommentId: meta.externalCommentId!,
          externalUpdatedAt: meta.externalUpdatedAt!,
          externalAuthor: meta.externalAuthor!,
        },
      );
    },
    recordPermanentFailure: async (message, httpStatus) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentCreateFailure,
        { commentId: args.commentId, message, httpStatus },
      );
    },
  };
}

export function commentEditSink(
  ctx: ActionCtx,
  commentLinkId: Id<"taskCommentIntegrationLinks">,
): OutboundRecorderSink {
  return {
    recordSuccess: async (meta) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentEditSuccess,
        { commentLinkId, externalUpdatedAt: meta.externalUpdatedAt! },
      );
    },
    recordPermanentFailure: async (message, httpStatus) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        { commentLinkId, message, httpStatus },
      );
    },
  };
}

/**
 * Issue-close sink (close the linked issue when its task is deleted). The task
 * and its link row are already gone (cascade-deleted before this op was
 * enqueued), so success has nothing to record and a permanent failure can only
 * be surfaced in the workspace audit log — there's no task row left to carry a
 * `lastSyncError` chip.
 */
export function issueCloseSink(
  ctx: ActionCtx,
  args: { workspaceId: Id<"workspaces">; issueNumber: number },
): OutboundRecorderSink {
  return {
    recordSuccess: async () => {
      // Nothing to mirror — the task (and its link) is gone.
    },
    recordPermanentFailure: async (message, httpStatus) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordIssueCloseFailure,
        {
          workspaceId: args.workspaceId,
          issueNumber: args.issueNumber,
          message,
          httpStatus,
        },
      );
    },
  };
}

export function commentDeleteSink(
  ctx: ActionCtx,
  commentLinkId: Id<"taskCommentIntegrationLinks">,
): OutboundRecorderSink {
  return {
    recordSuccess: async () => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations
          .recordCommentDeleteSuccess,
        { commentLinkId },
      );
    },
    recordPermanentFailure: async (message, httpStatus) => {
      await ctx.runMutation(
        internal.integrations.github.syncOutMutations.recordCommentLinkFailure,
        { commentLinkId, message, httpStatus },
      );
    },
  };
}
