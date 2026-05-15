import { ConvexError, v } from "convex/values";
import { mutation } from "../../_generated/server";
import { auditLog } from "../../auditLog";
import { requireWorkspaceMember } from "../../authHelpers";
import { WorkspaceRole } from "@ripple/shared/enums/roles";
import { canActivateIntegration } from "./activationGate";

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
    // project. Return the existing project id in the error so the UI can
    // offer "unlink it there first".
    const existing = await ctx.db
      .query("projectIntegrationLinks")
      .withIndex("by_externalRepo", (q) =>
        q.eq("externalRepoId", args.externalRepoId),
      )
      .first();
    if (existing) {
      throw new ConvexError(
        `Repository is already linked to project ${existing.projectId}`,
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

    return null;
  },
});

