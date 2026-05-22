import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { getAll } from "convex-helpers/server/relationships";
import { canActivateIntegration } from "./activationGate";

/**
 * Per-batch size for the disconnect cascade workpool drain. Each step
 * processes up to this many `taskIntegrationLinks` rows, writing freeze
 * snapshots + deleting child rows. Sized to stay well under Convex's
 * per-mutation document-churn limits even when every task has multiple
 * comment-link rows attached.
 */
export const DISCONNECT_BATCH_SIZE = 50;

/**
 * Per-batch size for the reconnect rehydration drain. Each step paginates
 * `tasks.by_project`, filters to those carrying a matching
 * `externalRefFrozen`, restores `externalRefs`, and inserts a fresh
 * `taskIntegrationLinks` row. Same sizing rationale as disconnect.
 */
export const RECONNECT_BATCH_SIZE = 50;

/**
 * Bind a repository to a project — the activation step of the integration
 * wizard. Provider-neutral mutation; the wizard fills the externalAccountId
 * and externalRepoId from the provider-specific account+repo pickers.
 *
 * Preconditions:
 *  - Caller is a workspace admin.
 *  - Project has a triage status (`canActivateIntegration === true`).
 *  - A `workspaceIntegrations` row exists for `(workspaceId, externalAccountId)`.
 *  - The repository is not already linked to any project anywhere
 *    (globally unique externalRepoId, enforced at the mutation layer).
 *
 * On success: inserts a `projectIntegrationLinks` row with
 * `status="active"`, `pausedByBilling=false`, and writes an
 * `integration.repo_linked` audit-log entry scoped to the workspace.
 */
/**
 * Live integration links for a project (anything not `disconnected`), for the
 * project-settings GitHub card. Lets the card reflect "already connected"
 * instead of inviting a duplicate link that `createLink` would reject. Member-
 * gated read; the heavier management surface stays in workspace settings.
 */
export const linksForProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("projectIntegrationLinks"),
      status: v.union(
        v.literal("configuring"),
        v.literal("active"),
        v.literal("paused"),
      ),
      externalRepoFullName: v.string(),
      pausedByBilling: v.boolean(),
    }),
  ),
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return [];
    await requireWorkspaceMember(ctx, project.workspaceId);

    const links = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    return links
      .filter((l) => l.status !== "disconnected")
      .map((l) => ({
        _id: l._id,
        status: l.status as "configuring" | "active" | "paused",
        externalRepoFullName: l.externalRepoFullName,
        pausedByBilling: l.pausedByBilling,
      }));
  },
});

export const createLink = mutation({
  args: {
    projectId: v.id("projects"),
    workspaceId: v.id("workspaces"),
    externalAccountId: v.string(),
    externalRepoId: v.string(),
    externalRepoFullName: v.string(),
  },
  returns: v.id("projectIntegrationLinks"),
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceMember(ctx, args.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (!(await canActivateIntegration(ctx, { projectId: args.projectId }))) {
      throw new ConvexError(
        "Cannot link a repository: project has no triage status",
      );
    }

    // The workspace must actually have an installation matching this
    // externalAccountId — defense-in-depth even though the wizard's account
    // picker only surfaces installed accounts.
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_externalAccount", (q) =>
        q.eq("externalAccountId", args.externalAccountId),
      )
      .unique();
    if (!integration || integration.workspaceId !== args.workspaceId) {
      throw new ConvexError(
        `No matching installation for externalAccountId ${args.externalAccountId}`,
      );
    }

    // Globally unique externalRepoId — a repo can be linked to at most one
    // ACTIVE/PAUSED project at a time. Disconnected rows are historical and
    // never block a fresh link (in fact reconnecting the same repo to the
    // same project is the expected rehydration path). Return the
    // conflicting project id in the error so the UI can offer
    // "unlink it there first" when there IS a live link elsewhere.
    const conflicts = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_externalRepo", (q) =>
        q.eq("externalRepoId", args.externalRepoId),
      )
      .collect();
    const liveConflict = conflicts.find(
      (c) => c.status !== "disconnected",
    );
    if (liveConflict) {
      throw new ConvexError(
        `Repository is already linked to project ${liveConflict.projectId}`,
      );
    }

    const linkId = await ctx.db.insert("projectIntegrationLinks", {
      projectId: args.projectId,
      workspaceId: args.workspaceId,
      status: "active",
      pausedByBilling: false,
      externalRepoId: args.externalRepoId,
      externalRepoFullName: args.externalRepoFullName,
    });

    // Reconnect rehydration. If any project task carries a frozen ref for
    // THIS repo (matching by stable `externalRepoId`, not name — survives
    // GitHub-side renames), restore its `externalRefs` and re-create the
    // per-task link row pointing at the new `linkId`. Drained via workpool
    // so even very large projects stay under per-mutation limits.
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.core.links.drainReconnectBatch,
      {
        projectIntegrationLinkId: linkId,
        cursor: null,
      },
    );

    // Integration events keep their PRD-intended action names ("integration.*")
    // rather than the resource-prefixed shape `logActivity` produces, so they
    // can be queried/filtered as a class across resource types.
    try {
      await auditLog.log(ctx, {
        action: "integration.repo_linked",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: args.projectId,
        severity: "info",
        metadata: { externalRepoFullName: args.externalRepoFullName },
        scope: args.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.repo_linked", err);
    }

    return linkId;
  },
});

/**
 * Pause a link. Sync stops in both directions (existing `effectiveLinkStatus`
 * gate handles inbound webhook drops and outbound dispatch skips). Webhooks
 * arriving during pause are dropped without queueing — resuming does NOT
 * fire a burst of stale events, per the PRD's "no catch-up" rule.
 *
 * Idempotent: pausing an already-paused link is a no-op (no second audit row).
 * Disconnected links cannot be paused — that's a terminal state.
 */
/**
 * Replace a link's branch→status automation map. Admin-only. Validates that
 * every referenced status belongs to the link's project (a foreign status
 * would silently never fire, or worse, leak across projects). Passing an
 * empty array clears the map (disables branch automation for the link).
 */
export const setBranchStatusMap = mutation({
  args: {
    linkId: v.id("projectIntegrationLinks"),
    entries: v.array(
      v.object({
        branch: v.string(),
        statusId: v.id("taskStatuses"),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError("Link not found");

    await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    for (const entry of args.entries) {
      const status = await ctx.db.get(entry.statusId);
      if (!status || status.projectId !== link.projectId) {
        throw new ConvexError(
          "Branch→status mapping references a status outside this project",
        );
      }
    }

    await ctx.db.patch(args.linkId, { branchStatusMap: args.entries });
    return null;
  },
});

export const pauseLink = mutation({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError("Link not found");

    const { userId } = await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (link.status === "disconnected") {
      throw new ConvexError("Cannot pause a disconnected link");
    }
    if (link.status === "paused") return null;

    await ctx.db.patch(args.linkId, { status: "paused" });

    try {
      await auditLog.log(ctx, {
        action: "integration.paused",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: link.projectId,
        severity: "info",
        metadata: { externalRepoFullName: link.externalRepoFullName },
        scope: link.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.paused", err);
    }

    return null;
  },
});

/**
 * Resume a paused link. Returns it to `active` so the existing
 * `effectiveLinkStatus` gate re-admits inbound webhooks and outbound
 * dispatch. Disconnected links cannot be resumed — that's terminal.
 *
 * Idempotent: resuming an already-active link is a no-op.
 */
export const resumeLink = mutation({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError("Link not found");

    const { userId } = await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (link.status === "disconnected") {
      throw new ConvexError("Cannot resume a disconnected link");
    }
    if (link.status === "active") return null;

    await ctx.db.patch(args.linkId, { status: "active" });

    try {
      await auditLog.log(ctx, {
        action: "integration.resumed",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: link.projectId,
        severity: "info",
        metadata: { externalRepoFullName: link.externalRepoFullName },
        scope: link.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.resumed", err);
    }

    return null;
  },
});

/**
 * Force a per-link reconcile of open/close + labels + assignees against
 * GitHub current truth. The mutation gate enforces admin + sync-active
 * (disconnected and entitlement-frozen links cannot be resynced — those
 * have to be restored first). On success it writes an audit log entry
 * and schedules the actual reconciliation action.
 *
 * Force resync is the recovery path for missed webhooks / extended freeze
 * periods (PRD: ">24 h freeze banner suggests Force resync"). The action
 * itself fetches current GitHub state per linked issue and applies a
 * synthesized normalized event so the existing inbound code path drives
 * the reconciliation.
 */
export const forceResync = mutation({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError("Link not found");

    const { userId } = await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    if (link.status === "disconnected") {
      throw new ConvexError("Cannot force-resync a disconnected link");
    }
    if (link.pausedByBilling) {
      throw new ConvexError(
        "Cannot force-resync a frozen link — restore the entitlement first",
      );
    }

    try {
      await auditLog.log(ctx, {
        action: "integration.force_resync",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: link.projectId,
        severity: "info",
        metadata: { externalRepoFullName: link.externalRepoFullName },
        scope: link.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.force_resync", err);
    }

    await ctx.scheduler.runAfter(
      0,
      internal.integrations.github.forceResyncAction.runForceResync,
      { projectIntegrationLinkId: args.linkId },
    );

    return null;
  },
});

/**
 * Mark a link as disconnected. Phase 1 minimum: status patch + audit log.
 * Phase 8 will extend this with the freeze-snapshot + hard-delete of
 * per-task / per-comment / per-PR link rows.
 */
export const unlinkLink = mutation({
  args: { linkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new ConvexError("Link not found");

    const { userId } = await requireWorkspaceMember(ctx, link.workspaceId, {
      role: WorkspaceRole.ADMIN,
    });

    await ctx.db.patch(args.linkId, { status: "disconnected" });

    try {
      await auditLog.log(ctx, {
        action: "integration.repo_unlinked",
        actorId: userId.toString(),
        resourceType: "projects",
        resourceId: link.projectId,
        severity: "info",
        metadata: { externalRepoFullName: link.externalRepoFullName },
        scope: link.workspaceId,
      });
    } catch (err) {
      console.error("[auditLog] failed to log integration.repo_unlinked", err);
    }

    // Kick off the cascade. Each drain step writes freeze snapshots on a
    // batch of tasks, deletes their child link rows, and reschedules
    // itself until exhausted. The status flip above is already visible to
    // the inbound/outbound gates, so further sync work stops immediately
    // regardless of how long the cascade takes.
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.core.links.drainDisconnectBatch,
      { projectIntegrationLinkId: args.linkId },
    );

    return null;
  },
});

/**
 * One drain step of the disconnect cascade. Internal — the only callers
 * are `unlinkLink` and self-reschedule. For up to `DISCONNECT_BATCH_SIZE`
 * task-link rows under this project link:
 *
 *   1. Read the linked task and write the frozen denormalized snapshot
 *      (`tasks.externalRefFrozen`) so historical context survives.
 *   2. Delete every `taskCommentIntegrationLinks` row pointing at the
 *      task link via the `by_taskIntegrationLink` index.
 *   3. Delete the task link row itself.
 *
 * If a full batch was processed, reschedule. Otherwise the cascade is
 * complete and we return cleanly. Idempotent: calling again after
 * completion is a no-op.
 *
 * NOTE on `taskPullRequestLinks`: Phase 7 was deferred so that table
 * does not yet exist. When PR linkage ships, its cleanup goes here.
 */
export const drainDisconnectBatch = internalMutation({
  args: { projectIntegrationLinkId: v.id("projectIntegrationLinks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("taskIntegrationLinks")
      .withIndex("by_link_externalIssueId", (q) =>
        q.eq("projectIntegrationLinkId", args.projectIntegrationLinkId),
      )
      .take(DISCONNECT_BATCH_SIZE);

    if (batch.length === 0) return null;

    const projectLink = await ctx.db.get(args.projectIntegrationLinkId);
    if (!projectLink) return null; // defensive — shouldn't happen
    const integration = await ctx.db
      .query("workspaceIntegrations")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", projectLink.workspaceId),
      )
      .unique();
    const provider = integration?.provider ?? "github";
    const disconnectedAt = Date.now();

    for (const taskLink of batch) {
      const task = await ctx.db.get(taskLink.taskId);
      if (task) {
        const ref = task.externalRefs?.[0];
        if (ref) {
          await ctx.db.patch(taskLink.taskId, {
            externalRefFrozen: {
              provider,
              externalRepoId: projectLink.externalRepoId,
              repoFullName: ref.repoFullName,
              issueNumber: ref.issueNumber,
              externalIssueId: taskLink.externalIssueId,
              url: ref.url,
              disconnectedAt,
              externalAuthor: taskLink.externalAuthor,
            },
            externalRefs: undefined,
          });
        }
      }

      // Comment links — fan out via the dedicated index.
      const commentLinks = await ctx.db
        .query("taskCommentIntegrationLinks")
        .withIndex("by_taskIntegrationLink", (q) =>
          q.eq("taskIntegrationLinkId", taskLink._id),
        )
        .collect();
      for (const cl of commentLinks) {
        await ctx.db.delete(cl._id);
      }

      await ctx.db.delete(taskLink._id);
    }

    if (batch.length === DISCONNECT_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.core.links.drainDisconnectBatch,
        { projectIntegrationLinkId: args.projectIntegrationLinkId },
      );
    }
    return null;
  },
});

/**
 * One drain step of the reconnect rehydration. Internal — only callers
 * are `createLink` and self-reschedule. Paginates `tasks.by_project`
 * (the frozen ref lives on the task, so we scan tasks rather than join
 * a non-existent index on `externalRefFrozen.externalRepoId`). Rehydration
 * is conservative: a task is restored only if its frozen ref's stable
 * `externalRepoId` matches the new link's repo id.
 *
 * On match: restore `tasks.externalRefs` from the frozen snapshot, clear
 * `externalRefFrozen`, insert a fresh `taskIntegrationLinks` row carrying
 * the frozen `externalIssueId` so subsequent webhooks idempotency-match
 * against the same external id.
 */
export const drainReconnectBatch = internalMutation({
  args: {
    projectIntegrationLinkId: v.id("projectIntegrationLinks"),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const projectLink = await ctx.db.get(args.projectIntegrationLinkId);
    // Disconnected during rehydration? Stop — the cascade will handle cleanup.
    if (!projectLink || projectLink.status !== "active") return null;

    const page = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) =>
        q.eq("projectId", projectLink.projectId),
      )
      .paginate({ cursor: args.cursor, numItems: RECONNECT_BATCH_SIZE });

    const now = Date.now();
    for (const task of page.page) {
      const frozen = task.externalRefFrozen;
      if (!frozen) continue;
      if (frozen.externalRepoId !== projectLink.externalRepoId) continue;

      // Skip if a per-task link already exists (defensive — shouldn't
      // happen since disconnect tears these down, but a botched cascade
      // shouldn't cause unique-by-task violations on rehydration).
      const existing = await ctx.db
        .query("taskIntegrationLinks")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .unique();
      if (existing) continue;

      await ctx.db.patch(task._id, {
        externalRefs: [
          {
            provider: frozen.provider,
            repoFullName: projectLink.externalRepoFullName,
            issueNumber: frozen.issueNumber,
            url: frozen.url,
          },
        ],
        externalRefFrozen: undefined,
      });
      await ctx.db.insert("taskIntegrationLinks", {
        taskId: task._id,
        projectIntegrationLinkId: args.projectIntegrationLinkId,
        externalIssueId: frozen.externalIssueId,
        externalUpdatedAt: now,
        // Restore the author preserved in the freeze snapshot. No inbound
        // event after creation rewrites `externalAuthor`, so the placeholder
        // fallback (only hit for links frozen before that field shipped)
        // would otherwise be permanent rather than corrected by a webhook.
        externalAuthor: frozen.externalAuthor ?? {
          login: "github",
          avatarUrl: "",
          url: "https://github.com",
        },
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.core.links.drainReconnectBatch,
        {
          projectIntegrationLinkId: args.projectIntegrationLinkId,
          cursor: page.continueCursor,
        },
      );
    }
    return null;
  },
});


/**
 * Workspace integrations tab data. Returns every link (active, paused, or
 * disconnected) for the workspace, joined to the project name for display.
 * Workspace-member-gated — non-members can't enumerate links. Admin-only
 * actions (pause, resume, unlink) check role separately at their boundary.
 *
 * Disconnected links are included so admins can audit history and recover
 * by reconnecting; the UI renders them differently (no action buttons).
 */
export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      _id: v.id("projectIntegrationLinks"),
      projectId: v.id("projects"),
      projectName: v.string(),
      status: v.union(
        v.literal("configuring"),
        v.literal("active"),
        v.literal("paused"),
        v.literal("disconnected"),
      ),
      pausedByBilling: v.boolean(),
      frozenAt: v.optional(v.number()),
      lastWebhookAt: v.optional(v.number()),
      externalRepoFullName: v.string(),
      externalRepoId: v.string(),
      branchStatusMap: v.optional(
        v.array(
          v.object({ branch: v.string(), statusId: v.id("taskStatuses") }),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const links = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    // Batched id→doc join (deduped, order-preserving) for the project name.
    // The link set is bounded by repos-linked-per-workspace, so collecting it
    // is fine; getAll just tidies the per-row fetch.
    const projects = await getAll(
      ctx.db,
      links.map((l) => l.projectId),
    );
    return links.map((l, i) => ({
      _id: l._id,
      projectId: l.projectId,
      projectName: projects[i]?.name ?? "(deleted project)",
      status: l.status,
      pausedByBilling: l.pausedByBilling,
      frozenAt: l.frozenAt,
      lastWebhookAt: l.lastWebhookAt,
      externalRepoFullName: l.externalRepoFullName,
      externalRepoId: l.externalRepoId,
      branchStatusMap: l.branchStatusMap,
    }));
  },
});
