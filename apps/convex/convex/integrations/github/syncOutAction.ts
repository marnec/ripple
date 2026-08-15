"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { runProviderOutbound } from "../core/runOutboundAction";
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
} from "../core/outboundSinks";

/**
 * Outbound dispatch actions, scheduled via `@convex-dev/action-retrier`.
 *
 * Each handler is one call to `runProviderOutbound` (`core/runOutboundAction`):
 * it resolves the GitHub gateway (or records a permanent failure if credentials
 * are missing) and runs the op's single gateway call. All the repeated
 * machinery — env/JWT/client construction, response
 * classification, the 404/429 special cases, multi-request fan-out, and the
 * retrier's return-vs-throw contract — lives behind the gateway
 * (`outboundGateway.ts`) and `core/runOutboundAction.ts`, each written and
 * tested exactly once. The only per-op variation that stays here is the sink
 * (which row to mirror onto) and the one gateway method to call.
 *
 * Args are the provider-neutral outbound contract the dispatch layer builds
 * (`core/outboundDispatch.ts`): `credentialRef` is the opaque credential handle
 * the adapter interprets (GitHub: the App installation id it mints a token
 * from); `projectRef`/`issueRef` are the neutral addressing pair (GitHub:
 * `owner/repo` + issue number). The provider→action routing lives in
 * `core/outboundAdapters.ts`, so a GitLab link never reaches these.
 */

const CREDS_MISSING = "GitHub App credentials not configured";

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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: issueCreateSink(ctx, {
        taskId: args.taskId,
        projectIntegrationLinkId: args.projectIntegrationLinkId,
      }),
      // Creates are the one op a retry cannot safely repeat, so ask the host
      // whether a previous attempt already made this issue before making
      // another. `runProviderOutbound` only skips the POST on a definite hit.
      precheck: (gateway) =>
        gateway.findIssueByRippleTask({
          projectRef: args.projectRef,
          taskId: args.taskId,
        }),
      call: (gateway) =>
        gateway.createIssue({
          projectRef: args.projectRef,
          title: args.title,
          body: args.body,
        }),
    }),
});

export const pushIssueState = internalAction({
  args: {
    taskId: v.id("tasks"),
    desiredState: v.union(v.literal("open"), v.literal("closed")),
    desiredStateReason: v.optional(
      v.union(v.literal("completed"), v.literal("not_planned")),
    ),
    /** Opaque credential handle, pre-resolved at scheduling time. */
    credentialRef: v.string(),
    /** Neutral project address (GitHub: `owner/repo`). */
    projectRef: v.string(),
    issueRef: v.number(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: taskStateSink(ctx, {
        taskId: args.taskId,
        state: args.desiredState,
        stateReason: args.desiredStateReason,
      }),
      call: (gateway) =>
        gateway.setIssueState({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          state: args.desiredState,
          stateReason: args.desiredStateReason,
        }),
    }),
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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: taskLabelsSink(ctx, {
        taskId: args.taskId,
        nextLabels: args.nextLabels,
      }),
      call: (gateway) =>
        gateway.setLabels({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          add: args.add,
          remove: args.remove,
        }),
    }),
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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: taskAssigneesSink(ctx, {
        taskId: args.taskId,
        nextLogins: args.nextLogins,
      }),
      call: (gateway) =>
        gateway.setAssignees({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          add: args.add,
          remove: args.remove,
        }),
    }),
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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: taskDescriptionSink(ctx, args.taskId),
      call: (gateway) =>
        gateway.setDescription({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          markdown: args.markdown,
        }),
    }),
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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: commentCreateSink(ctx, {
        commentId: args.commentId,
        taskIntegrationLinkId: args.taskIntegrationLinkId,
      }),
      // The comment sibling of `pushCreateIssue`'s guard. Without it the
      // retrier's re-run of a POST that already committed posts a second
      // comment on the customer's issue tracker — one Ripple can never clean
      // up, since only the last attempt's id reaches the link row.
      precheck: (gateway) =>
        gateway.findCommentByRippleComment({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          commentId: args.commentId,
        }),
      call: (gateway) =>
        gateway.createComment({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          body: args.body,
        }),
    }),
});

export const pushCommentEdit = internalAction({
  args: {
    commentLinkId: v.id("taskCommentIntegrationLinks"),
    externalCommentId: v.string(),
    body: v.string(),
    credentialRef: v.string(),
    projectRef: v.string(),
    // Carried for the neutral contract (GitLab needs it); GitHub edits a
    // comment by id alone and ignores it.
    issueRef: v.optional(v.number()),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: commentEditSink(ctx, args.commentLinkId),
      call: (gateway) =>
        gateway.editComment({
          projectRef: args.projectRef,
          externalCommentId: args.externalCommentId,
          body: args.body,
        }),
    }),
});

export const pushIssueClose = internalAction({
  args: {
    projectRef: v.string(),
    issueRef: v.number(),
    /** For the audit-log failure trace; the task itself is already deleted. */
    workspaceId: v.id("workspaces"),
    /** Provider this close targets — selects the install the audit entry is
     * attributed to (the task/link FK is already gone). */
    provider: v.string(),
    credentialRef: v.string(),
  },
  returns: v.null(),
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: issueCloseSink(ctx, {
        workspaceId: args.workspaceId,
        issueNumber: args.issueRef,
        provider: args.provider,
      }),
      call: (gateway) =>
        gateway.setIssueState({
          projectRef: args.projectRef,
          issueRef: args.issueRef,
          state: "closed",
          stateReason: "completed",
        }),
    }),
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
  handler: (ctx, args) =>
    runProviderOutbound({
      resolveGateway: () => makeGithubGateway(args.credentialRef),
      credsMissing: CREDS_MISSING,
      sink: commentDeleteSink(ctx, args.commentLinkId),
      call: (gateway) =>
        gateway.deleteComment({
          projectRef: args.projectRef,
          externalCommentId: args.externalCommentId,
        }),
    }),
});
