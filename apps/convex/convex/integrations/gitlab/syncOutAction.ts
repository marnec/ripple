import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { runOutboundOp } from "../core/outboundOrchestrator";
import { makeGitlabGateway } from "./outboundGateway";
import { getValidGitlabAccessToken } from "./tokenClient";
import {
  commentCreateSink,
  commentDeleteSink,
  commentEditSink,
  issueCloseSink,
  issueCreateSink,
  taskAssigneesSink,
  taskDescriptionSink,
  taskLabelsSink,
  taskStateSink,
} from "../core/outboundSinks";
import type { ActionCtx } from "../../_generated/server";
import type { OutboundGateway } from "../core/outboundPort";

/**
 * GitLab outbound dispatch actions, scheduled via `@convex-dev/action-retrier`
 * and routed here by the provider registry (`core/outboundAdapters`). They take
 * the SAME provider-neutral arg contract as the GitHub actions (the dispatch
 * layer builds one bag); the only differences are credential resolution (a
 * stored token fetched via `credentialRef` rather than a minted App token) and
 * the GitLab gateway behind the call.
 *
 * The recorder sinks (`../core/outboundSinks`) and their mutations are
 * provider-neutral — they mirror results onto `taskIntegrationLinks` — so
 * GitLab reuses them rather than duplicating the recorder layer.
 */

const CREDS_MISSING = "GitLab credentials not configured";

/**
 * Resolve the gateway from the stored credentials, refreshing the OAuth bundle
 * if expiry is within the skew window. PAT installs go through the same path
 * and short-circuit (no refresh material → return token as-is). Null means
 * "no usable credential" — the sink records a permanent failure.
 */
async function resolveGateway(
  ctx: ActionCtx,
  credentialRef: string,
): Promise<OutboundGateway | null> {
  const token = await getValidGitlabAccessToken(ctx, credentialRef);
  return token ? makeGitlabGateway(token) : null;
}

export const pushCreateIssue = internalAction({
  args: {
    taskId: v.id("tasks"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    title: v.string(),
    body: v.string(),
    credentialRef: v.string(),
    projectRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = issueCreateSink(ctx, {
      taskId: args.taskId,
      projectIntegrationLinkId: args.projectIntegrationLinkId,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.createIssue({
          projectRef: args.projectRef,
          title: args.title,
          body: args.body,
        }),
      sink,
    );
    return null;
  },
});

export const pushIssueState = internalAction({
  args: {
    taskId: v.id("tasks"),
    desiredState: v.union(v.literal("open"), v.literal("closed")),
    desiredStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskStateSink(ctx, {
      taskId: args.taskId,
      state: args.desiredState,
      stateReason: args.desiredStateReason,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setIssueState({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          state: args.desiredState,
          stateReason: args.desiredStateReason,
        }),
      sink,
    );
    return null;
  },
});

export const pushLabelChanges = internalAction({
  args: {
    taskId: v.id("tasks"),
    add: v.array(v.string()),
    remove: v.array(v.string()),
    nextLabels: v.array(v.string()),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskLabelsSink(ctx, {
      taskId: args.taskId,
      nextLabels: args.nextLabels,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setLabels({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          add: args.add,
          remove: args.remove,
        }),
      sink,
    );
    return null;
  },
});

export const pushAssigneeChanges = internalAction({
  args: {
    taskId: v.id("tasks"),
    add: v.array(v.string()),
    remove: v.array(v.string()),
    nextLogins: v.array(v.string()),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskAssigneesSink(ctx, {
      taskId: args.taskId,
      nextLogins: args.nextLogins,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setAssignees({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          add: args.add,
          remove: args.remove,
        }),
      sink,
    );
    return null;
  },
});

export const pushDescription = internalAction({
  args: {
    taskId: v.id("tasks"),
    markdown: v.string(),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskDescriptionSink(ctx, args.taskId);
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setDescription({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          markdown: args.markdown,
        }),
      sink,
    );
    return null;
  },
});

export const pushCommentCreate = internalAction({
  args: {
    commentId: v.id("taskComments"),
    body: v.string(),
    taskIntegrationLinkId: v.id("taskIntegrationLinks"),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentCreateSink(ctx, {
      commentId: args.commentId,
      taskIntegrationLinkId: args.taskIntegrationLinkId,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.createComment({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          body: args.body,
        }),
      sink,
    );
    return null;
  },
});

export const pushCommentEdit = internalAction({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalCommentId: v.string(),
    body: v.string(),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentEditSink(ctx, args.commentLinkId);
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.editComment({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          externalCommentId: args.externalCommentId,
          body: args.body,
        }),
      sink,
    );
    return null;
  },
});

export const pushIssueClose = internalAction({
  args: {
    projectRef: v.string(),
    issueRef: v.number(),
    workspaceId: v.id("workspaces"),
    /** Provider this close targets — selects the install the audit entry is
     * attributed to (the task/link FK is already gone). */
    provider: v.string(),
    credentialRef: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = issueCloseSink(ctx, {
      workspaceId: args.workspaceId,
      issueNumber: args.issueRef,
      provider: args.provider,
    });
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setIssueState({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          state: "closed",
          stateReason: "completed",
        }),
      sink,
    );
    return null;
  },
});

export const pushCommentDelete = internalAction({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalCommentId: v.string(),
    credentialRef: v.string(),
    projectRef: v.string(),
    issueRef: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentDeleteSink(ctx, args.commentLinkId);
    const gateway = await resolveGateway(ctx, args.credentialRef);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.deleteComment({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          externalCommentId: args.externalCommentId,
        }),
      sink,
    );
    return null;
  },
});
