import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { normalizeTagList, syncTaskTags } from "../../tagSync";
import { diffSet, normalizeLoginList } from "./syncableSet";
import { getWorkspaceIntegration } from "./integrationLookups";
import { taskHasBranchRuleMatch } from "./pullRequestAutomation";
import { applyStatusSideEffects } from "../../taskStatusSideEffects";
import type {
  NormalizedInstallationEvent,
  NormalizedIssueEvent,
} from "./types";

/**
 * Optional import-time context. Set by `core/importJob.applyImportBatch` so
 * tasks created during a bulk import get a stable `number` from the job's
 * pre-allocated range and an `importJobId` backref. Webhook callers leave
 * this undefined.
 */
export interface ImportContext {
  taskNumber: number;
  importJobId: Id<"taskImportJobs">;
}

/**
 * Apply a provider-neutral inbound event to Ripple state. Called from a
 * provider webhook adapter after signature verification, delivery dedup,
 * workspace/link resolution, and the freeze gate have already run — so
 * `applyNormalizedEvent` may assume the link is sync-active.
 *
 * Content-level idempotency (same `externalIssueId` twice) and content-level
 * ordering (`externalUpdatedAt` regression) are this module's responsibility.
 */
export async function applyNormalizedEvent(
  ctx: MutationCtx,
  args: {
    event: NormalizedIssueEvent;
    link: Doc<"projectIntegrationLinks">;
    importContext?: ImportContext;
  },
): Promise<void> {
  const { event, link, importContext } = args;

  const existingLink = await ctx.db
    .query("taskIntegrationLinks")
    .withIndex("by_link_externalIssueId", (q) =>
      q
        .eq("projectIntegrationLinkId", link._id)
        .eq("externalIssueId", event.externalIssueId),
    )
    .unique();

  switch (event.kind) {
    case "issue.opened":
      // Idempotency guard: redelivered open → no-op.
      if (existingLink) return;
      await createTaskFromEvent(ctx, {
        event,
        link,
        destinationStatus: await resolveTriageStatus(ctx, link.projectId),
        externalState: "open",
        importContext,
      });
      return;

    case "issue.closed":
      if (existingLink) {
        if (isStale(event, existingLink)) return;
        await updateExistingOnClose(ctx, { event, link, existingLink });
        return;
      }
      // Orphan close — never saw the open. Upsert directly into the
      // appropriate completed status, carrying full metadata from the event.
      await createTaskFromEvent(ctx, {
        event,
        link,
        destinationStatus: await resolveCompletedStatus(
          ctx,
          link.projectId,
          event.stateReason,
        ),
        externalState: "closed",
        externalStateReason: event.stateReason,
        importContext,
      });
      return;

    case "issue.labels_changed":
      // Label events arriving for an issue we never imported are dropped —
      // we don't synthesize an orphan task from a labels-only event.
      if (!existingLink) return;
      if (isStale(event, existingLink)) return;
      await applyLabelsChanged(ctx, { event, link, existingLink });
      return;

    case "issue.reopened":
      if (existingLink) {
        if (isStale(event, existingLink)) return;
        await updateExistingOnReopen(ctx, { event, link, existingLink });
        return;
      }
      // Orphan reopen — never saw the open. Upsert into triage so the team
      // re-reviews it before treating it as live work.
      await createTaskFromEvent(ctx, {
        event,
        link,
        destinationStatus: await resolveTriageStatus(ctx, link.projectId),
        externalState: "open",
        importContext,
      });
      return;

    case "issue.assignees_changed":
      // Assignee events arriving for an issue we never imported are dropped —
      // we don't synthesize an orphan task from an assignee-only event.
      if (!existingLink) return;
      if (isStale(event, existingLink)) return;
      await applyAssigneesChanged(ctx, { event, link, existingLink });
      return;

    case "comment.created":
      // Comments on issues we never imported are dropped — no orphan task
      // synthesis from a comment-only event.
      if (!existingLink) return;
      await applyCommentCreated(ctx, { event, link, existingLink });
      return;

    case "comment.edited":
      if (!existingLink) return;
      await applyCommentEdited(ctx, { event });
      return;

    case "comment.deleted":
      if (!existingLink) return;
      await applyCommentDeleted(ctx, { event });
      return;
  }
}

async function applyCommentDeleted(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "comment.deleted" }>;
  },
): Promise<void> {
  const { event } = args;
  const commentLink = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_externalCommentId", (q) =>
      q.eq("externalCommentId", event.externalCommentId),
    )
    .unique();
  if (!commentLink) return;
  if (isStaleUpdate(event.externalUpdatedAt, commentLink.externalUpdatedAt)) {
    return;
  }

  // Skip the comment-row write when it's already soft-deleted (e.g. the
  // bounce-back of our own outbound delete, or a redelivery that cleared the
  // staleness guard) — re-patching would needlessly invalidate comment
  // subscriptions. Still advance the mirror so later redeliveries drop.
  const comment = await ctx.db.get(commentLink.taskCommentId);
  if (comment && !comment.deleted) {
    await ctx.db.patch(commentLink.taskCommentId, { deleted: true });
  }
  await ctx.db.patch(commentLink._id, {
    externalUpdatedAt: event.externalUpdatedAt,
  });
}

async function applyCommentEdited(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "comment.edited" }>;
  },
): Promise<void> {
  const { event } = args;
  const commentLink = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_externalCommentId", (q) =>
      q.eq("externalCommentId", event.externalCommentId),
    )
    .unique();
  // Edits for comments we never imported are dropped.
  if (!commentLink) return;
  // Ordering guard: stale edits are dropped.
  if (isStaleUpdate(event.externalUpdatedAt, commentLink.externalUpdatedAt)) {
    return;
  }

  await ctx.db.patch(commentLink.taskCommentId, { body: event.body });
  await ctx.db.patch(commentLink._id, {
    externalUpdatedAt: event.externalUpdatedAt,
  });
}

async function applyCommentCreated(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "comment.created" }>;
    link: Doc<"projectIntegrationLinks">;
    existingLink: Doc<"taskIntegrationLinks">;
  },
): Promise<void> {
  const { event, link, existingLink } = args;

  // Idempotency: same externalCommentId arriving twice → no-op.
  const dupe = await ctx.db
    .query("taskCommentIntegrationLinks")
    .withIndex("by_externalCommentId", (q) =>
      q.eq("externalCommentId", event.externalCommentId),
    )
    .unique();
  if (dupe) return;

  const integration = await getWorkspaceIntegration(ctx, link.workspaceId);
  if (!integration) {
    throw new Error(
      `applyCommentCreated: workspace ${link.workspaceId} has no integration row`,
    );
  }

  const commentId = await ctx.db.insert("taskComments", {
    taskId: existingLink.taskId,
    userId: integration.botUserId,
    body: event.body,
    deleted: false,
  });

  await ctx.db.insert("taskCommentIntegrationLinks", {
    taskCommentId: commentId,
    taskIntegrationLinkId: existingLink._id,
    externalCommentId: event.externalCommentId,
    externalUpdatedAt: event.externalUpdatedAt,
    externalAuthor: event.externalAuthor,
  });
}

/**
 * Shared creation path. Inserts a new `tasks` row + a `taskIntegrationLinks`
 * row from a normalized event. Used by `issue.opened` and by orphan
 * close/reopen upserts.
 */
async function createTaskFromEvent(
  ctx: MutationCtx,
  args: {
    event: Exclude<
      NormalizedIssueEvent,
      {
        kind:
          | "issue.labels_changed"
          | "issue.assignees_changed"
          | "comment.created"
          | "comment.edited"
          | "comment.deleted";
      }
    >;
    link: Doc<"projectIntegrationLinks">;
    destinationStatus: Doc<"taskStatuses">;
    externalState: "open" | "closed";
    externalStateReason?: "completed" | "not_planned";
    importContext?: ImportContext;
  },
): Promise<void> {
  const {
    event,
    link,
    destinationStatus,
    externalState,
    externalStateReason,
    importContext,
  } = args;

  const integration = await getWorkspaceIntegration(ctx, link.workspaceId);
  if (!integration) {
    throw new Error(
      `applyNormalizedEvent: workspace ${link.workspaceId} has no integration row`,
    );
  }

  // Imports pre-allocate a number range on the project counter (see
  // importJob.ts), so reuse the supplied taskNumber. For webhook-created
  // tasks there is no import context, so allocate the next sequential number
  // off the project counter — same serialization point as tasks.create.
  let number = importContext?.taskNumber;
  if (number === undefined) {
    const project = await ctx.db.get(link.projectId);
    if (!project) {
      throw new Error(
        `createTaskFromEvent: project ${link.projectId} not found`,
      );
    }
    number = (project.taskCounter ?? 0) + 1;
    await ctx.db.patch(link.projectId, { taskCounter: number });
  }

  const taskId = await ctx.db.insert("tasks", {
    projectId: link.projectId,
    workspaceId: link.workspaceId,
    title: event.title,
    statusId: destinationStatus._id,
    priority: "medium",
    completed: destinationStatus.isCompleted,
    creatorId: integration.botUserId,
    number,
    importJobId: importContext?.importJobId,
    externalRefs: [
      {
        provider: integration.provider,
        repoFullName: link.externalRepoFullName,
        issueNumber: event.issueNumber,
        url: event.url,
      },
    ],
  });

  await ctx.db.insert("taskIntegrationLinks", {
    taskId,
    projectIntegrationLinkId: link._id,
    externalIssueId: event.externalIssueId,
    externalUpdatedAt: event.externalUpdatedAt,
    externalAuthor: event.externalAuthor,
    initialBodyMarkdown: event.body,
    externalState,
    externalStateReason,
  });
}

async function updateExistingOnClose(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "issue.closed" }>;
    link: Doc<"projectIntegrationLinks">;
    existingLink: Doc<"taskIntegrationLinks">;
  },
): Promise<void> {
  const { event, link, existingLink } = args;

  // Precedence: when a merged PR's target branch matches a branch→status rule,
  // that transition is authoritative — suppress the generic issue-close
  // completion (it would downgrade the branch-mapped status). The link mirror
  // is still advanced so the outbound echo guard and redelivery dedup hold.
  const branchRuleGoverns = await taskHasBranchRuleMatch(
    ctx,
    existingLink.taskId,
  );

  if (!branchRuleGoverns) {
    const targetStatus = await resolveCompletedStatus(
      ctx,
      link.projectId,
      event.stateReason,
    );
    const task = await ctx.db.get(existingLink.taskId);
    if (task) {
      // Canonical status side-effects: closes the open work period on an
      // inbound close, which the hand-rolled patch here used to skip.
      await ctx.db.patch(existingLink.taskId, {
        statusId: targetStatus._id,
        ...applyStatusSideEffects(task, targetStatus),
      });
    }
  }

  await ctx.db.patch(existingLink._id, {
    externalUpdatedAt: event.externalUpdatedAt,
    externalState: "closed",
    externalStateReason: event.stateReason,
    externalClosedBy: event.closedBy,
  });
}

async function applyLabelsChanged(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "issue.labels_changed" }>;
    link: Doc<"projectIntegrationLinks">;
    existingLink: Doc<"taskIntegrationLinks">;
  },
): Promise<void> {
  const { event, link, existingLink } = args;

  const task = await ctx.db.get(existingLink.taskId);
  if (!task) return;

  const normalized = normalizeTagList(event.labels);

  // Echo guard: if the inbound set already matches the last-known GitHub
  // set, this event is a bounce-back from our own outbound write. Skip the
  // taskTags reconciliation and externalUpdatedAt bump entirely.
  if (!diffSet(normalized, existingLink.externalLabels).changed) return;

  // Reconcile the dictionary `tags` + project-scoped `taskTags` join. We then
  // mirror that list into `tasks.labels` (denormalized projection) and into
  // `taskIntegrationLinks.externalLabels` (the last-known GitHub set).
  await syncTaskTags(ctx, {
    workspaceId: link.workspaceId,
    projectId: link.projectId,
    taskId: task._id,
    completed: task.completed,
    dueDate: task.dueDate,
    plannedStartDate: task.plannedStartDate,
    assigneeId: task.assigneeId,
    nextTagNames: normalized,
  });

  await ctx.db.patch(task._id, { labels: normalized });
  await ctx.db.patch(existingLink._id, {
    externalLabels: normalized,
    externalUpdatedAt: event.externalUpdatedAt,
  });
}

/**
 * Reconcile the task's `assigneeId` against the GitHub assignee set. First
 * login that maps to a workspace member via `workspaceMemberExternalIdentity`
 * wins; the rest land on the link's shadow set for display. When no GitHub
 * login matches a member, `assigneeId` falls back to the integration's bot
 * user — the full set still mirrors onto the link so the UI can render real
 * GitHub identities without pretending they're Ripple members.
 */
async function applyAssigneesChanged(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "issue.assignees_changed" }>;
    link: Doc<"projectIntegrationLinks">;
    existingLink: Doc<"taskIntegrationLinks">;
  },
): Promise<void> {
  const { event, link, existingLink } = args;

  const nextLogins = normalizeLoginList(event.assignees.map((a) => a.login));

  // Echo guard: same set as last-known → bounce-back from our own outbound.
  if (!diffSet(nextLogins, existingLink.externalAssigneeLogins).changed) return;

  // First-matching-login wins for `assigneeId`. The non-winning entries
  // (unmatched logins + matched-but-not-first) become the shadow set. If
  // the GitHub set is non-empty but no login resolves to a workspace member,
  // fall back to the integration's bot user so the task surfaces a sensible
  // owner — the real identities still render via the shadow chips.
  let matchedUserId: Doc<"users">["_id"] | undefined;
  let winnerIndex = -1;
  for (let i = 0; i < event.assignees.length; i++) {
    const a = event.assignees[i];
    const identity = await ctx.db
      .query("workspaceMemberExternalIdentity")
      .withIndex("by_workspace_provider_login", (q) =>
        q
          .eq("workspaceId", link.workspaceId)
          .eq("provider", "github")
          .eq("externalLogin", a.login.toLowerCase()),
      )
      .unique();
    if (identity) {
      matchedUserId = identity.userId;
      winnerIndex = i;
      break;
    }
  }

  let shadowAssignees = event.assignees;
  if (winnerIndex >= 0) {
    shadowAssignees = event.assignees.filter((_, i) => i !== winnerIndex);
  } else if (event.assignees.length > 0) {
    // No-match fallback: bot user takes the slot; every real identity stays
    // visible via shadow chips.
    const integration = await getWorkspaceIntegration(ctx, link.workspaceId);
    if (integration) {
      matchedUserId = integration.botUserId;
    }
  }

  await ctx.db.patch(existingLink._id, {
    externalAssigneeLogins: nextLogins,
    externalAssignees: shadowAssignees,
    externalUpdatedAt: event.externalUpdatedAt,
  });

  // Only patch the task row when the resolved assignee actually changed —
  // avoids unnecessary subscription invalidations on the kanban-hot row.
  const task = await ctx.db.get(existingLink.taskId);
  if (!task) return;
  if (task.assigneeId !== matchedUserId) {
    await ctx.db.patch(task._id, { assigneeId: matchedUserId });
  }
}

async function updateExistingOnReopen(
  ctx: MutationCtx,
  args: {
    event: Extract<NormalizedIssueEvent, { kind: "issue.reopened" }>;
    link: Doc<"projectIntegrationLinks">;
    existingLink: Doc<"taskIntegrationLinks">;
  },
): Promise<void> {
  const { event, link, existingLink } = args;

  const triageStatus = await resolveTriageStatus(ctx, link.projectId);

  const task = await ctx.db.get(existingLink.taskId);
  if (task) {
    await ctx.db.patch(existingLink.taskId, {
      statusId: triageStatus._id,
      ...applyStatusSideEffects(task, triageStatus),
    });
  }
  await ctx.db.patch(existingLink._id, {
    externalUpdatedAt: event.externalUpdatedAt,
    externalState: "open",
    externalStateReason: undefined,
  });
}

/**
 * Inbound ordering predicate. An incoming `externalUpdatedAt` not strictly
 * newer than the stored mirror describes stale state. Equality counts as
 * stale so the guard is idempotent against exact retries. Shared by every
 * inbound staleness check (issue update events + comment edit/delete) so the
 * `<=` semantics live in exactly one place.
 */
export function isStaleUpdate(
  incomingUpdatedAt: number,
  storedUpdatedAt: number,
): boolean {
  return incomingUpdatedAt <= storedUpdatedAt;
}

/**
 * Ordering guard for issue update-kind events (close, reopen, labels,
 * assignees). Thin wrapper over `isStaleUpdate` carrying the event/link
 * shapes the router works with.
 */
function isStale(
  event: Extract<
    NormalizedIssueEvent,
    {
      kind:
        | "issue.closed"
        | "issue.reopened"
        | "issue.labels_changed"
        | "issue.assignees_changed";
    }
  >,
  existingLink: Doc<"taskIntegrationLinks">,
): boolean {
  return isStaleUpdate(event.externalUpdatedAt, existingLink.externalUpdatedAt);
}

async function resolveTriageStatus(
  ctx: MutationCtx,
  projectId: Doc<"projectIntegrationLinks">["projectId"],
): Promise<Doc<"taskStatuses">> {
  const triage = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project_isTriage", (q) =>
      q.eq("projectId", projectId).eq("isTriage", true),
    )
    .unique();
  if (!triage) {
    throw new Error(
      `applyNormalizedEvent: project ${projectId} has no triage status`,
    );
  }
  return triage;
}

/**
 * Pick the destination completed status for an inbound `issue.closed` event.
 *
 *  - state_reason='not_planned' → first status with `isCompleted=true` and
 *    `externalCloseReason='not_planned'`, ordered by `order`. Falls back to
 *    the default-completed routing when none is configured.
 *  - state_reason='completed' (or any other) → first `isCompleted=true`
 *    status by `order`.
 */
async function resolveCompletedStatus(
  ctx: MutationCtx,
  projectId: Doc<"projectIntegrationLinks">["projectId"],
  stateReason: "completed" | "not_planned",
): Promise<Doc<"taskStatuses">> {
  if (stateReason === "not_planned") {
    const notPlanned = await ctx.db
      .query("taskStatuses")
      .withIndex("by_project_isCompleted_closeReason_order", (q) =>
        q
          .eq("projectId", projectId)
          .eq("isCompleted", true)
          .eq("externalCloseReason", "not_planned"),
      )
      .first();
    if (notPlanned) return notPlanned;
    // Fall through to the default-completed routing.
  }

  const completed = await ctx.db
    .query("taskStatuses")
    .withIndex("by_project_isCompleted_order", (q) =>
      q.eq("projectId", projectId).eq("isCompleted", true),
    )
    .first();
  if (!completed) {
    throw new Error(
      `applyNormalizedEvent: project ${projectId} has no completed status`,
    );
  }
  return completed;
}

/**
 * Apply an installation-lifecycle event. Auto-disconnects affected links
 * when the GitHub App is uninstalled or specific repos are removed from
 * the installation. Each disconnected link kicks off the standard
 * disconnect cascade (freeze snapshots + hard-delete of per-task /
 * per-comment link rows) via the shared workpool drain, identical to the
 * admin-initiated `unlinkLink` path.
 */
export async function applyInstallationEvent(
  ctx: MutationCtx,
  args: { event: NormalizedInstallationEvent },
): Promise<void> {
  const { event } = args;

  const integration = await ctx.db
    .query("workspaceIntegrations")
    .withIndex("by_externalAccount", (q) =>
      q.eq("externalAccountId", event.externalAccountId),
    )
    .unique();
  if (!integration) return; // unknown installation — drop silently

  if (event.kind === "installation.deleted") {
    const links = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", integration.workspaceId),
      )
      .collect();
    for (const link of links) {
      if (link.status === "disconnected") continue;
      await ctx.db.patch(link._id, { status: "disconnected" });
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.core.links.drainDisconnectBatch,
        { projectIntegrationLinkId: link._id },
      );
    }
    return;
  }

  // installation_repositories.removed — disconnect only the listed repos.
  const targetIds = new Set(event.externalRepoIds);
  for (const repoId of targetIds) {
    const link = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_externalRepo", (q) => q.eq("externalRepoId", repoId))
      .unique();
    if (!link) continue;
    if (link.workspaceId !== integration.workspaceId) continue;
    if (link.status === "disconnected") continue;
    await ctx.db.patch(link._id, { status: "disconnected" });
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.core.links.drainDisconnectBatch,
      { projectIntegrationLinkId: link._id },
    );
  }
}
