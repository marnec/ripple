"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { runOutboundOp } from "../core/outboundOrchestrator";
import { makeGithubGateway } from "./outboundGateway";
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
} from "./outboundSinks";

/**
 * Outbound dispatch actions, scheduled via `@convex-dev/action-retrier`.
 *
 * Each action is a thin shell: build the recorder sink, resolve the GitHub
 * gateway (or record a permanent failure if credentials are missing), then
 * hand a single gateway call to `runOutboundOp`. All the repeated machinery —
 * env/JWT/client construction, response classification, the 404/429 special
 * cases, multi-request fan-out, and the retrier's return-vs-throw contract —
 * lives behind the gateway (`outboundGateway.ts`) and the orchestrator
 * (`core/outboundOrchestrator.ts`), each written and tested exactly once.
 */

const CREDS_MISSING = "GitHub App credentials not configured";

export const pushCreateIssue = internalAction({
  args: {
    taskId: v.id("tasks"),
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    title: v.string(),
    body: v.string(),
    installationId: v.string(),
    repoFullName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = issueCreateSink(ctx, {
      taskId: args.taskId,
      projectIntegrationLinkId: args.projectIntegrationLinkId,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.createIssue({
          repoFullName: args.repoFullName,
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
    /** Pre-resolved at scheduling time. */
    installationId: v.string(),
    /** `owner/repo` — never the stable id; GitHub's REST takes the name. */
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskStateSink(ctx, {
      taskId: args.taskId,
      state: args.desiredState,
      stateReason: args.desiredStateReason,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setIssueState({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskLabelsSink(ctx, {
      taskId: args.taskId,
      nextLabels: args.nextLabels,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setLabels({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskAssigneesSink(ctx, {
      taskId: args.taskId,
      nextLogins: args.nextLogins,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setAssignees({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = taskDescriptionSink(ctx, args.taskId);
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setDescription({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
    issueNumber: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentCreateSink(ctx, {
      commentId: args.commentId,
      taskIntegrationLinkId: args.taskIntegrationLinkId,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.createComment({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentEditSink(ctx, args.commentLinkId);
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.editComment({
          repoFullName: args.repoFullName,
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
    repoFullName: v.string(),
    issueNumber: v.number(),
    /** For the audit-log failure trace; the task itself is already deleted. */
    workspaceId: v.id("workspaces"),
    installationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = issueCloseSink(ctx, {
      workspaceId: args.workspaceId,
      issueNumber: args.issueNumber,
    });
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.setIssueState({
          repoFullName: args.repoFullName,
          issueNumber: args.issueNumber,
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
    installationId: v.string(),
    repoFullName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sink = commentDeleteSink(ctx, args.commentLinkId);
    const gateway = makeGithubGateway(args.installationId);
    if (!gateway) {
      await sink.recordPermanentFailure(CREDS_MISSING);
      return null;
    }
    await runOutboundOp(
      () =>
        gateway.deleteComment({
          repoFullName: args.repoFullName,
          externalCommentId: args.externalCommentId,
        }),
      sink,
    );
    return null;
  },
});
